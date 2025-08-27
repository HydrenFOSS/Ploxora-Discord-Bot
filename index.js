require("dotenv").config();
const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const Logger = require("./utilities/logger");
const logger = new Logger({ prefix: "BOT", level: "debug" });

// ------------------ DATABASE ------------------
const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) console.error("❌ DB Connection error:", err);
  else console.log("✅ Connected to SQLite DB");
});

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS coins (userId TEXT PRIMARY KEY, balance INTEGER)");
  db.run("CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, usages INTEGER, amount INTEGER)");
});

function getCoins(userId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT balance FROM coins WHERE userId = ?", [userId], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.balance : 0);
    });
  });
}

function setCoins(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO coins (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = ?",
      [userId, amount, amount],
      (err) => (err ? reject(err) : resolve(amount))
    );
  });
}

async function addCoins(userId, amount) {
  let bal = await getCoins(userId);
  bal += amount;
  await setCoins(userId, bal);
  return bal;
}

async function removeCoins(userId, amount) {
  let bal = await getCoins(userId);
  bal = Math.max(0, bal - amount);
  await setCoins(userId, bal);
  return bal;
}

function getCode(code) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM codes WHERE code = ?", [code], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function setCode(code, usages, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO codes (code, usages, amount) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET usages = ?, amount = ?",
      [code, usages, amount, usages, amount],
      (err) => (err ? reject(err) : resolve(true))
    );
  });
}

// ------------------ HELPERS ------------------
function createEmbed(title, description, color = 0x2b2d31) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

async function isRegistered(id) {
  try {
    const res = await axios.get(`${process.env.PLOXORA_URL}/api/v1/list/users?x-api-key=${process.env.API_KEY}`);
    return res.data.users.find(u => u.id === id) || null;
  } catch (err) {
    console.error("❌ Failed to check registration:", err);
    return null;
  }
}

// ------------------ DISCORD CLIENT ------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// Slash Commands
const commands = [
  { name: "daily", description: "Claim daily coins" },
  { name: "cf", description: "Coinflip: heads or tails", options: [
    { name: "choice", description: "Pick heads or tails", type: 3, required: true, choices: [
      { name: "heads", value: "heads" }, { name: "tails", value: "tails" }
    ] },
    { name: "bet", description: "Amount of coins to bet", type: 4, required: true }
  ] },
  { name: "deploy", description: "Deploy a server if you have enough coins" },
  { name: "claimcode", description: "Claim a coin code", options: [
    { name: "code", description: "The code you want to redeem", type: 3, required: true }
  ] },
  { name: "money", description: "Manage user money (Admin)", options: [
    { name: "action", description: "set/add/remove", type: 3, required: true, choices: [
      { name: "set", value: "set" }, { name: "add", value: "add" }, { name: "remove", value: "remove" }
    ] },
    { name: "user", description: "Target user", type: 6, required: true },
    { name: "amount", description: "Coins", type: 4, required: true }
  ] },
  { name: "codes", description: "Create redeem codes (Admin)", options: [
    { name: "usages", description: "How many times code can be used", type: 4, required: true },
    { name: "coins", description: "How many coins per redemption", type: 4, required: true }
  ] }
];

(async () => {
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  logger.info("✅ Slash commands registered");
})();

// ------------------ BOT LOGIC ------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, user, member } = interaction;

  // Ensure registered in dashboard
  const apiUser = await isRegistered(user.id);
  if (!apiUser && commandName !== "money" && commandName !== "codes") {
    return interaction.reply({
      embeds: [createEmbed("❌ Error", `Please register on the dashboard first using discord login: ${process.env.PLOXORA_URL}`)]});
  }

  // --- DAILY ---
  if (commandName === "daily") {
    let bal = await addCoins(user.id, 100);
    interaction.reply({ embeds: [createEmbed("✅ Daily Reward", `You claimed **100 coins**! Balance: **${bal}**`)] });
  }

  // --- COINFLIP ---
  if (commandName === "cf") {
    const choice = options.getString("choice");
    const bet = options.getInteger("bet");
    let bal = await getCoins(user.id);
    if (bal < bet) return interaction.reply({ embeds: [createEmbed("❌ Error", "Not enough coins!")] });

    const result = Math.random() < 0.5 ? "heads" : "tails";
    if (result === choice) {
      bal = await addCoins(user.id, bet);
      interaction.reply({ embeds: [createEmbed("🎉 You Win!", `It was **${result}**! You won **${bet}**. Balance: **${bal}**`)] });
    } else {
      bal = await removeCoins(user.id, bet);
      interaction.reply({ embeds: [createEmbed("😢 You Lost", `It was **${result}**. You lost **${bet}**. Balance: **${bal}**`)] });
    }
  }

  // --- DEPLOY ---
 if (commandName === "deploy") {
  const bal = await getCoins(user.id);
  const cost = parseInt(process.env.TOTAL_COINS_REQUIRED_FOR_DEPLOYMENT);

  if (bal < cost) {
    return interaction.reply({ 
      embeds: [createEmbed("❌ Error", `You need **${cost} coins** to deploy a server. Current: **${bal}**`)], 
      ephemeral: true 
    });
  }

  await interaction.reply({ 
    embeds: [createEmbed("⌛ Deploying Server..", "Please wait while we set up your server.")], 
    ephemeral: true 
  });

  try {
    // 🔍 Check user from API instead of local Map
    const userRes = await axios.get(`${process.env.PLOXORA_URL}/api/v1/list/users?x-api-key=${process.env.API_KEY}`);
    const users = userRes.data.users || [];
    const apiUser = users.find(u => u.id === user.id);

  //  if (!apiUser) {
   //   return interaction.editReply({ 
   //     embeds: [createEmbed("❌ Error", "You are not registered. Use /register first.")] 
   //   });
  //  }

    // Fetch first available node
    const nodes = await axios.get(`${process.env.PLOXORA_URL}/api/v1/list/nodes?x-api-key=${process.env.API_KEY}`);
    const node = nodes.data.nodes[0];
    if (!node) {
      return interaction.editReply({ 
        embeds: [createEmbed("❌ Error", "No nodes available.")] 
      });
    }

    // Deploy server
    const res = await axios.post(`${process.env.PLOXORA_URL}/api/v1/servers/deploy?x-api-key=${process.env.API_KEY}`, {
      name: user.username,
      gb: process.env.DEFAULT_RAM,
      cores: process.env.DEFAULT_CORES,
      userId: apiUser.id, // <-- use ID from API
      nodeId: node.id
    });


    if (res.data.success) {
      await removeCoins(user.id, cost);
      let ssh = res.data.server?.ssh || "";
      ssh = ssh.replace(/^ssh session:\s*/i, "");

      await interaction.editReply({ 
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Server Deployed")
            .setDescription(`Your server has been deployed successfully!\n\n🔗 **Login:** ${process.env.PLOXORA_URL}\n🖥️ **Node:** ${node.name}\n💾 **RAM:** ${process.env.DEFAULT_RAM} GB\n⚙️ **Cores:** ${process.env.DEFAULT_CORES}\n **SSH:** ${ssh}`)
            .setColor(0x2ecc71)
            .setThumbnail(node.image || null)
        ]
      });
    } else {
      await interaction.editReply({ 
        embeds: [createEmbed("❌ Error", "Failed to deploy server.")] 
      });
    }
  } catch (err) {
    await interaction.editReply({ 
      embeds: [createEmbed("❌ Error", "Error deploying server.")] 
    });
  }
}

  // --- CLAIM CODE ---
  if (commandName === "claimcode") {
    const code = options.getString("code");
    const entry = await getCode(code);
    if (!entry) return interaction.reply({ embeds: [createEmbed("❌ Error", "Invalid code.")] });
    if (entry.usages <= 0) return interaction.reply({ embeds: [createEmbed("❌ Error", "Code expired.")] });

    await addCoins(user.id, entry.amount);
    await setCode(code, entry.usages - 1, entry.amount);
    interaction.reply({ embeds: [createEmbed("✅ Code Redeemed", `You received **${entry.amount} coins**.`)] });
  }

  // --- ADMIN: MONEY ---
  if (commandName === "money") {
    if (!member.roles.cache.has(process.env.ADMIN_ROLE_ID)) return interaction.reply({ embeds: [createEmbed("❌ Error", "No permission.")] });
    const action = options.getString("action");
    const target = options.getUser("user");
    const amount = options.getInteger("amount");

    if (action === "set") await setCoins(target.id, amount);
    if (action === "add") await addCoins(target.id, amount);
    if (action === "remove") await removeCoins(target.id, amount);

    const bal = await getCoins(target.id);
    interaction.reply({ embeds: [createEmbed("✅ Money Updated", `${action} ${amount} coins. New balance: **${bal}**`)] });
  }

  // --- ADMIN: CODES ---
  if (commandName === "codes") {
    if (!member.roles.cache.has(process.env.ADMIN_ROLE_ID)) return interaction.reply({ embeds: [createEmbed("❌ Error", "No permission.")] });
    const usages = options.getInteger("usages");
    const amount = options.getInteger("coins");
    const code = Math.random().toString(36).substring(2, 10);
    await setCode(code, usages, amount);
    interaction.reply({ embeds: [createEmbed("✅ Code Created", `Code: **${code}** Usages: **${usages}** Amount: **${amount}**`)] });
  }
});

client.once("ready", () => logger.info(`🤖 Logged in as ${client.user.tag}`));
client.login(process.env.TOKEN);
