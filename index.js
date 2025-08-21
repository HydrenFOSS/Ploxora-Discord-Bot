require("dotenv").config();
const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const Keyv = require("keyv").default;
const crypto = require("crypto");
const Logger = require("./utilities/logger");
const logger = new Logger({ prefix: "BOT", level: "debug" });
// DBs
const coins = new Keyv("sqlite://coins.sqlite");
const codes = new Keyv("sqlite://codes.sqlite");
const registered = new Keyv("sqlite://registered.sqlite");

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// Economy helpers
async function getCoins(userId) {
  return (await coins.get(userId)) || 0;
}
async function addCoins(userId, amount) {
  let bal = await getCoins(userId);
  bal += amount;
  await coins.set(userId, bal);
  return bal;
}
async function removeCoins(userId, amount) {
  let bal = await getCoins(userId);
  bal = Math.max(0, bal - amount);
  await coins.set(userId, bal);
  return bal;
}

// Slash Commands
const commands = [
  { 
    name: "register", 
    description: "Register a new Ploxora account" 
  },
  { 
    name: "daily", 
    description: "Claim daily coins" 
  },
  { 
    name: "cf", 
    description: "Coinflip: heads or tails", 
    options: [
      { 
        name: "choice", 
        description: "Pick heads or tails", 
        type: 3, 
        required: true, 
        choices: [
          { name: "heads", value: "heads" }, 
          { name: "tails", value: "tails" }
        ] 
      }, 
      { 
        name: "bet", 
        description: "Amount of coins to bet", 
        type: 4, 
        required: true 
      }
    ] 
  },
  { 
    name: "deploy", 
    description: "Deploy a server if you have enough coins" 
  },
  { 
    name: "claimcode", 
    description: "Claim a coin code", 
    options: [
      { 
        name: "code", 
        description: "The code you want to redeem", 
        type: 3, 
        required: true 
      }
    ] 
  },

  // Admin commands
  { 
    name: "money", 
    description: "Manage user money", 
    options: [
      { 
        name: "action", 
        description: "Choose whether to set, add, or remove coins", 
        type: 3, 
        required: true, 
        choices: [
          { name: "set", value: "set" }, 
          { name: "add", value: "add" }, 
          { name: "remove", value: "remove" }
        ] 
      }, 
      { 
        name: "user", 
        description: "The user to apply the action to", 
        type: 6, 
        required: true 
      }, 
      { 
        name: "amount", 
        description: "Amount of coins to set, add, or remove", 
        type: 4, 
        required: true 
      }
    ] 
  },
  { 
    name: "codes", 
    description: "Create redeem codes", 
    options: [
      { 
        name: "usages", 
        description: "How many times this code can be redeemed", 
        type: 4, 
        required: true 
      }, 
      { 
        name: "coins", 
        description: "How many coins to give per redemption", 
        type: 4, 
        required: true 
      }
    ] 
  }
];


// Deploy slash commands
(async () => {
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  logger.info("✅ Slash commands registered");
})();

// Helper for embeds
function createEmbed(title, description, color = 0x2b2d31) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

// Bot logic
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, user, member } = interaction;

  // --- REGISTER ---
if (commandName === "register") {
  const already = await registered.get(user.id);
  if (already) return interaction.reply({ embeds: [createEmbed("❌ Error", "You already have an account.")], ephemeral: true });

  const password = crypto.randomBytes(6).toString("hex");
  const email = `${user.id}_discord@gmail.com`;

  // Initial response
  await interaction.reply({ 
    embeds: [createEmbed("⌛ Creating Account..", "Please wait while we register your Ploxora account.")], 
    ephemeral: true 
  });

  try {
    const res = await axios.post(`${process.env.PLOXORA_URL}/api/v1/users/new?x-api-key=${process.env.API_KEY}`, {
      username: user.username,
      email,
      password,
    });

    if (res.data.success) {
      await registered.set(user.id, res.data.user.id);

      await user.send(`✅ Your Ploxora account is created!\n**Username:** ${user.username}\n**Email:** ${email}\n**Password:** ${password}`);

      await interaction.editReply({ 
        embeds: [createEmbed("📩 Registered", "Check your DMs for login details.")] 
      });
    } else {
      await interaction.editReply({ 
        embeds: [createEmbed("❌ Error", "Account already exists!")] 
      });
    }
  } catch (err) {
    await interaction.editReply({ 
      embeds: [createEmbed("❌ Error", "Failed to register. Try again.")] 
    });
  }
}
  // --- DAILY ---
  if (commandName === "daily") {
    let bal = await addCoins(user.id, 100);
    interaction.reply({ embeds: [createEmbed("✅ Daily Reward", `You claimed **100 coins**!\nBalance: **${bal}**`)] });
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
      interaction.reply({ embeds: [createEmbed("🎉 You Win!", `It was **${result}**! You won **${bet}**.\nBalance: **${bal}**`)] });
    } else {
      bal = await removeCoins(user.id, bet);
      interaction.reply({ embeds: [createEmbed("😢 You Lost", `It was **${result}**. You lost **${bet}**.\nBalance: **${bal}**`)] });
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
    const apiUser = users.find(u => u.username === user.username);

    if (!apiUser) {
      return interaction.editReply({ 
        embeds: [createEmbed("❌ Error", "You are not registered. Use /register first.")] 
      });
    }

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

      await interaction.editReply({ 
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Server Deployed")
            .setDescription(`Your server has been deployed successfully!\n\n🔗 **Login:** ${process.env.PLOXORA_URL}\n🖥️ **Node:** ${node.name}\n💾 **RAM:** ${process.env.DEFAULT_RAM} GB\n⚙️ **Cores:** ${process.env.DEFAULT_CORES}\n **SSH:** ${res.data.ssh}`)
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
    const entry = await codes.get(code);

    if (!entry) return interaction.reply({ embeds: [createEmbed("❌ Error", "Invalid code.")] });
    if (entry.usages <= 0) return interaction.reply({ embeds: [createEmbed("❌ Error", "Code expired.")] });

    await addCoins(user.id, entry.amount);
    entry.usages -= 1;
    await codes.set(code, entry);
    interaction.reply({ embeds: [createEmbed("✅ Code Redeemed", `You received **${entry.amount} coins**.`)] });
  }

  // --- ADMIN ---
  if (commandName === "money") {
    if (!member.roles.cache.has(process.env.ADMIN_ROLE_ID)) return interaction.reply({ embeds: [createEmbed("❌ Error", "No permission.")] });
    const action = options.getString("action");
    const target = options.getUser("user");
    const amount = options.getInteger("amount");

    if (action === "set") await coins.set(target.id, amount);
    if (action === "add") await addCoins(target.id, amount);
    if (action === "remove") await removeCoins(target.id, amount);

    const bal = await getCoins(target.id);
    interaction.reply({ embeds: [createEmbed("✅ Money Updated", `${action} ${amount} coins. New balance: **${bal}**`)] });
  }

  if (commandName === "codes") {
    if (!member.roles.cache.has(process.env.ADMIN_ROLE_ID)) return interaction.reply({ embeds: [createEmbed("❌ Error", "No permission.")] });

    const usages = options.getInteger("usages");
    const amount = options.getInteger("coins");
    const code = crypto.randomBytes(4).toString("hex");

    await codes.set(code, { usages, amount });
    interaction.reply({ embeds: [createEmbed("✅ Code Created", `Code: **${code}**\nUsages: **${usages}**\nAmount: **${amount}**`)] });
  }
});

client.once("ready", () => logger.info(`🤖 Logged in as ${client.user.tag}`));
client.login(process.env.TOKEN);
