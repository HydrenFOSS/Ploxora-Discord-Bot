class Logger {
  constructor({ prefix = "App", level = "info" } = {}) {
    this.prefix = prefix;
    this.level = level;
    this.levels = ["debug", "info", "warn", "error", "init"];

    // ANSI color codes
    this.colors = {
      reset: "\x1b[0m",
      gray: "\x1b[90m",
      cyan: "\x1b[36m",
      yellow: "\x1b[33m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      magenta: "\x1b[35m",
      dim: "\x1b[2m",
    };
  }

  format(level, msg) {
    const c = this.colors;
    const timestamp = `${c.dim}[${new Date().toISOString()}]${c.reset}`;
    const prefix = `${c.magenta}[${this.prefix}]${c.reset}`;

    const levelDots = {
      debug: c.gray + "●" + c.reset,
      info: c.cyan + "●" + c.reset,
      warn: c.yellow + "●" + c.reset,
      error: c.red + "●" + c.reset,
      init: c.green + "●" + c.reset,
    };

    return `${timestamp} ${prefix} ${levelDots[level]} ${msg}`;
  }

  log(level, msg = "") {
    if (this.levels.indexOf(level) >= this.levels.indexOf(this.level)) {
      console.log(this.format(level, msg));
    }
  }

  debug(msg) {
    this.log("debug", msg);
  }

  info(msg) {
    this.log("info", msg);
  }

  warn(msg) {
    this.log("warn", msg);
  }

  error(msg) {
    this.log("error", msg);
  }

  init(msg) {
    this.log("init", msg);
  }
}

module.exports = Logger;