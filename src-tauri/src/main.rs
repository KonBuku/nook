// No console window behind the notch in a release build. Kept in debug so
// `NOOK_LOG=debug pnpm start` has somewhere to print.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nook_lib::run()
}
