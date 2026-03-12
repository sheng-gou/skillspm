class CommandDefinition {
  constructor(name = "") {
    this.commandName = name;
    this.summary = "";
    this.subcommands = [];
    this.options = [];
    this.arguments = [];
    this.actionHandler = async () => {};
  }

  name(name) {
    this.commandName = name;
    return this;
  }

  description(summary) {
    this.summary = summary;
    return this;
  }

  command(name) {
    const subcommand = new CommandDefinition(name.trim());
    this.subcommands.push(subcommand);
    return subcommand;
  }

  argument(spec, _description) {
    this.arguments.push(parseArgument(spec));
    return this;
  }

  option(spec, _description) {
    this.options.push(parseOption(spec));
    return this;
  }

  action(handler) {
    this.actionHandler = handler;
    return this;
  }

  async parseAsync(argv, options = {}) {
    const args = options.from === "user" ? argv : argv.slice(2);
    if (this.subcommands.length === 0) {
      const { positionals, parsedOptions } = parseTokens(args, this.options);
      await this.invoke(positionals, parsedOptions);
      return this;
    }

    const [commandName, ...rest] = args;
    if (!commandName) {
      throw new Error(`No command provided for ${this.commandName}`);
    }

    const subcommand = this.subcommands.find((candidate) => candidate.commandName === commandName);
    if (!subcommand) {
      throw new Error(`Unknown command: ${commandName}`);
    }

    const { positionals, parsedOptions } = parseTokens(rest, subcommand.options);
    await subcommand.invoke(positionals, parsedOptions);
    return this;
  }

  async invoke(positionals, parsedOptions) {
    for (const [index, argument] of this.arguments.entries()) {
      if (argument.required && positionals[index] === undefined) {
        throw new Error(`Missing required argument ${argument.name}`);
      }
    }
    const forwardedArgs = [...positionals.slice(0, this.arguments.length), parsedOptions];
    await this.actionHandler(...forwardedArgs);
  }
}

function parseArgument(spec) {
  const trimmed = spec.trim();
  return {
    name: trimmed.replace(/[<>\[\]]/g, ""),
    required: trimmed.startsWith("<")
  };
}

function parseOption(spec) {
  const tokens = spec
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/,$/, ""));
  const shortFlag = tokens.find((token) => /^-[^-]$/.test(token));
  const longName = tokens.find((token) => token.startsWith("--"));
  if (!longName) {
    throw new Error(`Unsupported option spec: ${spec}`);
  }
  return {
    flag: longName,
    shortFlag,
    name: longName.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()),
    expectsValue: tokens.some((token) => token.startsWith("<") || token.startsWith("["))
  };
}

function parseTokens(tokens, definitions) {
  const parsedOptions = {};
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("-")) {
      const option = definitions.find((candidate) => candidate.flag === token || candidate.shortFlag === token);
      if (!option) {
        throw new Error(`Unknown option: ${token}`);
      }
      if (option.expectsValue) {
        index += 1;
        if (index >= tokens.length) {
          throw new Error(`Option ${token} expects a value`);
        }
        parsedOptions[option.name] = tokens[index];
      } else {
        parsedOptions[option.name] = true;
      }
      continue;
    }
    positionals.push(token);
  }

  return { positionals, parsedOptions };
}

export class Command extends CommandDefinition {}
