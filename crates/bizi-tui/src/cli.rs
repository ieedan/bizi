//! Argument parsing. Mirrors `lib/args.ts` and `commands/cli.ts`, including the
//! implicit `bizi <task>` → `bizi run <task>` rewrite.

use clap::{Parser, Subcommand};

const RESERVED_SUBCOMMANDS: [&str; 4] = ["run", "cancel", "stat", "init"];

#[derive(Debug, Clone)]
pub struct CliOptions {
    pub cwd: String,
}

#[derive(Debug, Parser)]
#[command(
    name = "bizi",
    about = "Terminal UI for bizi",
    version = env!("CARGO_PKG_VERSION")
)]
pub struct Cli {
    /// Set working directory for task discovery and runs
    #[arg(short = 'C', long, global = true)]
    pub cwd: Option<String>,

    #[command(subcommand)]
    pub command: Option<CliCommand>,
}

#[derive(Debug, Subcommand)]
pub enum CliCommand {
    /// Run a task
    Run {
        task: String,
        /// Disable prompts and only cancel on exit when this session started the run
        #[arg(long = "non-interactive", default_value_t = false)]
        non_interactive: bool,
    },
    /// Cancel a task
    Cancel { task: String },
    /// Show task status
    Stat {
        task: String,
        /// Print machine-readable JSON output
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Create a starter task.config.json
    Init,
}

pub enum CliMode {
    Tui(CliOptions),
    Command(CliCommand, CliOptions, bool),
}

pub fn default_cwd() -> String {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

/// Resolves whether we should launch the TUI or run a one-shot command.
pub fn resolve_cli_mode(argv: &[String]) -> Result<CliMode, clap::Error> {
    let (normalized, was_implicit_run) = normalize_implicit_run_command(argv);

    let mut parse_input = vec!["bizi".to_string()];
    parse_input.extend(normalized);

    let cli = Cli::try_parse_from(parse_input)?;
    let options = CliOptions {
        cwd: cli.cwd.unwrap_or_else(default_cwd),
    };

    match cli.command {
        Some(command) => Ok(CliMode::Command(command, options, was_implicit_run)),
        None => Ok(CliMode::Tui(options)),
    }
}

fn normalize_implicit_run_command(argv: &[String]) -> (Vec<String>, bool) {
    let Some(first_positional_index) = find_first_positional_token_index(argv) else {
        return (argv.to_vec(), false);
    };

    let first_positional = &argv[first_positional_index];
    if RESERVED_SUBCOMMANDS.contains(&first_positional.as_str()) {
        return (argv.to_vec(), false);
    }

    let mut normalized = argv.to_vec();
    normalized.insert(first_positional_index, "run".to_string());
    (normalized, true)
}

fn find_first_positional_token_index(argv: &[String]) -> Option<usize> {
    let mut index = 0usize;
    while index < argv.len() {
        let token = argv[index].as_str();
        if token.is_empty() {
            index += 1;
            continue;
        }
        if token == "--" {
            return if index + 1 < argv.len() {
                Some(index + 1)
            } else {
                None
            };
        }
        if !token.starts_with('-') {
            return Some(index);
        }
        if token == "-C" || token == "--cwd" {
            index += 1;
        }
        index += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(tokens: &[&str]) -> Vec<String> {
        tokens.iter().map(|token| (*token).to_string()).collect()
    }

    #[test]
    fn treats_a_bare_invocation_as_the_tui() {
        assert!(find_first_positional_token_index(&argv(&[])).is_none());
        assert!(find_first_positional_token_index(&argv(&["-C", "/tmp"])).is_none());
        assert!(find_first_positional_token_index(&argv(&["--cwd", "/tmp"])).is_none());
    }

    #[test]
    fn finds_positionals_after_flags() {
        assert_eq!(
            find_first_positional_token_index(&argv(&["-C", "/tmp", "dev"])),
            Some(2)
        );
        assert_eq!(
            find_first_positional_token_index(&argv(&["--cwd=/tmp", "dev"])),
            Some(1)
        );
        assert_eq!(
            find_first_positional_token_index(&argv(&["--", "dev"])),
            Some(1)
        );
        assert!(find_first_positional_token_index(&argv(&["--"])).is_none());
    }

    #[test]
    fn rewrites_implicit_runs_but_leaves_subcommands_alone() {
        let (normalized, implicit) = normalize_implicit_run_command(&argv(&["dev"]));
        assert_eq!(normalized, argv(&["run", "dev"]));
        assert!(implicit);

        let (normalized, implicit) = normalize_implicit_run_command(&argv(&["stat", "dev"]));
        assert_eq!(normalized, argv(&["stat", "dev"]));
        assert!(!implicit);

        let (normalized, implicit) =
            normalize_implicit_run_command(&argv(&["-C", "/tmp", "dev:api"]));
        assert_eq!(normalized, argv(&["-C", "/tmp", "run", "dev:api"]));
        assert!(implicit);
    }

    #[test]
    fn parses_commands_and_the_global_cwd_flag() {
        match resolve_cli_mode(&argv(&["-C", "/tmp", "stat", "dev", "--json"])).unwrap() {
            CliMode::Command(CliCommand::Stat { task, json }, options, implicit) => {
                assert_eq!(task, "dev");
                assert!(json);
                assert_eq!(options.cwd, "/tmp");
                assert!(!implicit);
            }
            _ => panic!("expected a stat command"),
        }

        match resolve_cli_mode(&argv(&["dev"])).unwrap() {
            CliMode::Command(CliCommand::Run { task, .. }, _, implicit) => {
                assert_eq!(task, "dev");
                assert!(implicit);
            }
            _ => panic!("expected an implicit run command"),
        }

        assert!(matches!(
            resolve_cli_mode(&argv(&[])).unwrap(),
            CliMode::Tui(_)
        ));
    }

    #[test]
    fn rejects_unknown_options() {
        assert!(resolve_cli_mode(&argv(&["--nope"])).is_err());
    }

    #[test]
    fn reports_the_crate_version() {
        for flag in ["--version", "-V"] {
            let Err(error) = resolve_cli_mode(&argv(&[flag])) else {
                panic!("expected a version exit for {flag}");
            };
            assert_eq!(error.kind(), clap::error::ErrorKind::DisplayVersion);
            assert_eq!(error.exit_code(), 0);
            assert!(error.to_string().contains(env!("CARGO_PKG_VERSION")));
        }
    }
}
