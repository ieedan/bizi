mod api;
mod cli;
mod cli_task_runs;
mod commands;
mod keyboard;
mod logs;
mod model;
mod prompt;
mod status;
mod task_runs;
mod task_structure;
mod tui;

use api::BiziApi;
use cli::{CliCommand, CliMode, resolve_cli_mode};

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();

    let mode = match resolve_cli_mode(&argv) {
        Ok(mode) => mode,
        Err(error) => {
            let _ = error.print();
            // clap exits 2 on a usage error where the TypeScript client exits
            // 1. `--help` and `--version` still exit 0.
            let exit_code = if error.exit_code() == 0 { 0 } else { 1 };
            std::process::exit(exit_code);
        }
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };

    let exit_code = runtime.block_on(dispatch(mode));
    std::process::exit(exit_code);
}

async fn dispatch(mode: CliMode) -> i32 {
    match mode {
        CliMode::Tui(options) => match tui::run_tui(options).await {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("{error}");
                1
            }
        },
        CliMode::Command(command, options, _was_implicit_run) => {
            let api = BiziApi::new();
            let result = match command {
                CliCommand::Run {
                    task,
                    non_interactive,
                } => commands::run::run_command(&api, &options.cwd, &task, non_interactive).await,
                CliCommand::Cancel { task } => {
                    commands::cancel::cancel_command(&api, &options.cwd, &task).await
                }
                CliCommand::Stat { task, json } => {
                    commands::stat::stat_command(&api, &options.cwd, &task, json).await
                }
                CliCommand::Init => commands::init::init_command(&options.cwd).await,
            };

            match result {
                Ok(exit_code) => exit_code,
                Err(error) => {
                    eprintln!("{error}");
                    1
                }
            }
        }
    }
}
