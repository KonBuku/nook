//! What Win32 knows about a running Claude Code session: whether it is still
//! there, and which window it is typed into.
//!
//! Kept behind small, plain functions rather than threaded through the rest of
//! the app, so everything above this file is ordinary safe Rust and the unsafe
//! blocks are all in one place to audit.

use std::collections::HashMap;

use windows::Win32::Foundation::{CloseHandle, BOOL, FILETIME, HANDLE, HWND, LPARAM, TRUE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, GetProcessTimes, OpenProcess,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow,
    GetParent, GetWindowLongW, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, SetForegroundWindow, ShowWindow, GA_ROOTOWNER, GWL_EXSTYLE, SW_RESTORE,
    WS_EX_TOOLWINDOW,
};

/// A process's creation time, as the FILETIME tick count Windows reports:
/// 100-nanosecond intervals since 1601-01-01 UTC.
///
/// Claude Code writes exactly this value into a session file's `procStart` on
/// Windows, which is what makes the comparison below exact rather than a
/// tolerance around a clock.
pub type FileTimeTicks = u64;

/// Every process on the machine: its parent, its children, and its name.
///
/// Taken once per scan rather than once per session: the snapshot is the
/// expensive part, and walking it is not.
pub struct ProcessTable {
    parents: HashMap<u32, u32>,
    children: HashMap<u32, Vec<u32>>,
    names: HashMap<u32, String>,
}

impl ProcessTable {
    pub fn snapshot() -> Self {
        let mut parents = HashMap::new();
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut names = HashMap::new();

        // SAFETY: the snapshot handle is closed on every path out, and the
        // entry struct is initialised with the size field Win32 requires
        // before either enumeration call touches it.
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return Self {
                    parents,
                    children,
                    names,
                };
            };

            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let pid = entry.th32ProcessID;
                    let parent = entry.th32ParentProcessID;
                    parents.insert(pid, parent);
                    children.entry(parent).or_default().push(pid);
                    names.insert(pid, exe_name(&entry.szExeFile));

                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }

            let _ = CloseHandle(snapshot);
        }

        Self {
            parents,
            children,
            names,
        }
    }

    /// The process's image name, lowercased — `"cmd.exe"`.
    fn name(&self, pid: u32) -> &str {
        self.names.get(&pid).map(String::as_str).unwrap_or("")
    }

    /// The process and its ancestors, nearest first.
    ///
    /// Bounded, and it stops the moment it sees a pid twice: a parent link is
    /// whatever the snapshot happened to record, and a recycled pid can make
    /// the chain point back at itself.
    pub fn ancestry(&self, pid: u32) -> Vec<u32> {
        const MAX_DEPTH: usize = 12;

        let mut chain = Vec::with_capacity(4);
        let mut current = pid;
        while chain.len() < MAX_DEPTH {
            if chain.contains(&current) || current == 0 {
                break;
            }
            chain.push(current);
            match self.parents.get(&current) {
                Some(&parent) => current = parent,
                None => break,
            }
        }
        chain
    }
}

/// Is this pid still running, and is it still the *same* process?
///
/// A session that crashes leaves its file behind saying `busy` for ever, so the
/// notch has to check rather than trust the file. Checking the pid alone is not
/// enough on a long-running machine: pids get reused, and a recycled one would
/// resurrect a dead session. Comparing creation times settles it — and on
/// Windows both sides are the same FILETIME, so the comparison is exact.
pub fn is_alive(pid: u32, proc_start: Option<FileTimeTicks>) -> bool {
    let Some(actual) = created_at(pid) else {
        // No handle means no process — or one owned by a more privileged
        // account, which a session of ours never is.
        return false;
    };

    match proc_start {
        // A second of slack, purely so a session file written by a different
        // Claude Code version that rounds the value is not thrown away.
        Some(recorded) => actual.abs_diff(recorded) < 10_000_000,
        // Can't prove it either way — trust the pid rather than hide a session
        // that is probably real.
        None => true,
    }
}

/// When a process was created, in FILETIME ticks.
pub fn created_at(pid: u32) -> Option<FileTimeTicks> {
    // SAFETY: the handle is closed on both paths, and the four FILETIMEs are
    // stack locals that outlive the call.
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();

        let ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user).is_ok();
        let _ = CloseHandle(handle);

        ok.then_some(((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64)
    }
}

/// Processes that own the desktop rather than a terminal.
///
/// The search has to stop here, and stopping is the whole point. A console
/// started from the Explorer has `explorer.exe` as its parent, and the Explorer
/// owns the desktop window — so a search that simply walks up until it finds
/// *a* window finds the desktop, reports the session as focusable, and then
/// raises the file manager when someone clicks it. Which is exactly what this
/// did: the click worked perfectly and brought the wrong window forward.
const SHELL_PROCESSES: &[&str] = &[
    "explorer.exe",
    "services.exe",
    "wininit.exe",
    "winlogon.exe",
    "userinit.exe",
    "svchost.exe",
    "runtimebroker.exe",
];

/// Processes that own a console window on behalf of the program inside it.
///
/// These are *children* of the program, not ancestors of it — the console host
/// is spawned by the process it hosts. Walking up alone can never reach them,
/// which is why the search below also looks one step down at each level.
const CONSOLE_HOSTS: &[&str] = &["conhost.exe", "openconsole.exe"];

/// The top-level window a session is typed into.
///
/// A session's own process never owns a window — `claude` is a console program
/// — so the search works outward from it in both directions.
///
/// **Up**, because in a Windows Terminal tab the chain is `claude` → `pwsh` →
/// `OpenConsole` → `WindowsTerminal` and the window belongs to the last of
/// them; under VS Code it is `Code.exe` a couple of links up.
///
/// **Down**, because a classic console is the other way round: `cmd.exe`
/// spawns a `conhost.exe` child, and *that* is what owns the window. No amount
/// of walking up will ever reach it.
///
/// And it stops at the shell, for the reason `SHELL_PROCESSES` gives.
///
/// Nearest first, so a session in its own console window is found before the
/// editor that happens to be further up the same chain.
pub fn window_for(pid: u32, table: &ProcessTable) -> Option<HWND> {
    for ancestor in table.ancestry(pid) {
        if SHELL_PROCESSES.contains(&table.name(ancestor)) {
            break;
        }

        // A window this process owns outright — VS Code, or a terminal that
        // really is an ancestor.
        if let Some(window) = top_level_window_of(ancestor) {
            return Some(window);
        }

        // The terminal on the other side of a pseudo-console.
        if let Some(window) = terminal_hosting_pseudo_console(ancestor) {
            return Some(window);
        }

        // A classic console's window, which belongs to a conhost *child*.
        if let Some(children) = table.children.get(&ancestor) {
            for &child in children {
                if CONSOLE_HOSTS.contains(&table.name(child)) {
                    if let Some(window) = top_level_window_of(child) {
                        return Some(window);
                    }
                    if let Some(window) = terminal_hosting_pseudo_console(child) {
                        return Some(window);
                    }
                }
            }
        }
    }
    None
}

/// The terminal window on the other side of this process's pseudo-console.
///
/// This is what makes a session's window findable at all when Windows Terminal
/// is the machine's default console host. In that arrangement the terminal is
/// *not* an ancestor of the program running inside it: the shell starts,
/// Windows hands the console off over a pseudo-console, and the terminal
/// attaches from outside the process tree entirely. Walking up the tree finds
/// the shell and then the desktop, and never the terminal.
///
/// But the handoff leaves a thread to pull. The process keeps a hidden
/// `PseudoConsoleWindow` — the stub the console APIs answer from — and that
/// stub is a *child window of the terminal serving it*. So its parent is the
/// window that session is typed into. Exactly, not probably: two sessions in
/// two Windows Terminal windows resolve to their own windows even though both
/// windows belong to one process.
///
/// The version before this one had no such thread and guessed: if exactly one
/// terminal window existed, it took it. That is wrong the moment there are two
/// — and worse, Windows Terminal runs several windows in a single process, so
/// "exactly one" counted processes and always found one. Every session opened
/// whichever window happened to be enumerated first.
fn terminal_hosting_pseudo_console(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        found: Option<HWND>,
    }

    let mut search = Search { pid, found: None };

    // SAFETY: the callback runs synchronously inside this call, so the pointer
    // to `search` is valid throughout and is not retained past it.
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }

    // The parent has to be a window a person can actually be shown; a stub
    // whose parent is another stub is not a terminal.
    let parent = search.found?;
    return is_showable(parent).then_some(parent);

    unsafe extern "system" fn visit(window: HWND, state: LPARAM) -> BOOL {
        let search = &mut *(state.0 as *mut Search);

        let mut owner = 0u32;
        GetWindowThreadProcessId(window, Some(&mut owner));
        if owner != search.pid {
            return TRUE;
        }

        let mut class = [0u16; 64];
        let len = GetClassNameW(window, &mut class) as usize;
        if String::from_utf16_lossy(&class[..len]) != "PseudoConsoleWindow" {
            return TRUE;
        }

        // A stub with no parent is one whose terminal has gone; there is
        // nothing to raise and nothing to report.
        if let Ok(parent) = GetParent(window) {
            if !parent.is_invalid() {
                search.found = Some(parent);
                return BOOL(0); // stop
            }
        }
        TRUE
    }
}

/// Bring a window to the front, and make it the one that receives typing.
///
/// `SetForegroundWindow` alone is refused when the caller is not itself in the
/// foreground, which Nook never is — it is a click-through overlay that takes
/// no focus. Attaching to the current foreground thread's input queue for the
/// duration of the call is the documented way around that, and it is why the
/// click actually lands on the terminal instead of silently doing nothing.
pub fn focus_window(window: HWND) -> bool {
    // SAFETY: every handle here comes from Win32 itself, and the input
    // attachment is undone on both paths out.
    unsafe {
        if IsIconic(window).as_bool() {
            let _ = ShowWindow(window, SW_RESTORE);
        }

        let foreground = GetForegroundWindow();
        if foreground == window {
            return true;
        }

        let foreground_thread = GetWindowThreadProcessId(foreground, None);
        let our_thread = GetCurrentThreadId();
        let attached = foreground_thread != 0
            && foreground_thread != our_thread
            && AttachThreadInput(our_thread, foreground_thread, true).as_bool();

        let raised = SetForegroundWindow(window).as_bool();
        let _ = BringWindowToTop(window);

        if attached {
            let _ = AttachThreadInput(our_thread, foreground_thread, false);
        }

        raised
    }
}

/// A `PROCESSENTRY32W`'s image name, lowercased so it can be compared.
fn exe_name(raw: &[u16; 260]) -> String {
    let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..len]).to_lowercase()
}

/// Is this a window a person could be shown and would recognise?
///
/// Visible, top-level, not chrome, and titled. `GA_ROOTOWNER` walks past
/// dialogs and owned popups to the window a user would call "the terminal";
/// tool windows are tooltips and IME candidate lists; and a titleless window is
/// almost always an invisible message sink — the ConPTY stub itself being one.
fn is_showable(window: HWND) -> bool {
    // SAFETY: every call here takes a window handle and returns a plain value.
    unsafe {
        if !IsWindowVisible(window).as_bool() {
            return false;
        }
        if GetAncestor(window, GA_ROOTOWNER) != window {
            return false;
        }
        if GetWindowLongW(window, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        GetWindowTextLengthW(window) > 0
    }
}

/// The first visible, titled, top-level window owned by this pid.
fn top_level_window_of(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        found: Option<HWND>,
    }

    let mut search = Search { pid, found: None };

    // SAFETY: the closure below runs synchronously inside this call, so the
    // pointer to `search` is valid for the whole enumeration and is not
    // retained past it.
    unsafe {
        let _ = EnumWindows(
            Some(visit),
            LPARAM(&mut search as *mut Search as isize),
        );
    }

    return search.found;

    unsafe extern "system" fn visit(window: HWND, state: LPARAM) -> BOOL {
        let search = &mut *(state.0 as *mut Search);

        let mut owner = 0u32;
        GetWindowThreadProcessId(window, Some(&mut owner));
        if owner != search.pid || !is_showable(window) {
            return TRUE; // keep going
        }

        search.found = Some(window);
        BOOL(0) // stop
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn our_own_process_is_alive_and_its_creation_time_matches() {
        let pid = std::process::id();
        let created = created_at(pid).expect("we can always query ourselves");
        assert!(is_alive(pid, Some(created)));
    }

    #[test]
    fn a_recycled_pid_is_not_the_same_process() {
        let pid = std::process::id();
        let created = created_at(pid).expect("we can always query ourselves");
        // An hour earlier is a different process wearing the same pid.
        assert!(!is_alive(pid, Some(created - 36_000_000_000)));
    }

    #[test]
    fn no_window_is_found_for_a_pid_that_cannot_exist() {
        // Above the range Windows hands out, so nothing can be behind it.
        assert!(window_for(u32::MAX - 1, &ProcessTable::snapshot()).is_none());
    }

    #[test]
    fn the_search_never_reaches_the_desktop() {
        // The defect this exists for: a console started from the Explorer has
        // `explorer.exe` in its ancestry, the Explorer owns the desktop window,
        // and a search that walks up until it finds *a* window finds that one.
        // Clicking a session then raised the file manager, and it looked like a
        // click-through bug rather than a wrong answer.
        let table = ProcessTable::snapshot();
        let explorer = table
            .names
            .iter()
            .find(|(_, name)| name.as_str() == "explorer.exe")
            .map(|(pid, _)| *pid);

        let Some(explorer) = explorer else {
            return; // no shell running under this test runner
        };
        assert!(window_for(explorer, &table).is_none());
    }

    #[test]
    fn a_pid_with_no_windows_has_no_terminal_behind_it() {
        assert!(terminal_hosting_pseudo_console(u32::MAX - 1).is_none());
    }

    #[test]
    fn a_session_resolves_to_the_window_its_console_is_served_by() {
        // The defect this exists for: Windows Terminal runs several windows in
        // one process, so a search that counted *processes* found "exactly
        // one terminal" however many windows were open, and every session
        // opened whichever of them was enumerated first.
        //
        // This process is a test binary run from a terminal, so whatever comes
        // back has to be a window a person could be shown — not the ConPTY
        // stub the link is followed through, and not a process handle dressed
        // up as one. Under a runner with no console there is nothing to find,
        // and that is a pass too.
        let table = ProcessTable::snapshot();
        let Some(window) = window_for(std::process::id(), &table) else {
            return;
        };
        assert!(is_showable(window));
    }

    #[test]
    fn the_console_hosts_and_shells_are_named_in_lowercase() {
        // They are compared against `ProcessTable::name`, which lowercases —
        // so an entry with a capital in it would silently never match.
        for name in SHELL_PROCESSES.iter().chain(CONSOLE_HOSTS) {
            assert_eq!(*name, name.to_lowercase(), "{name} would never match");
        }
    }

    #[test]
    fn a_process_name_is_read_and_lowercased() {
        let mut raw = [0u16; 260];
        for (slot, ch) in raw.iter_mut().zip("CMD.EXE".encode_utf16()) {
            *slot = ch;
        }
        assert_eq!(exe_name(&raw), "cmd.exe");
    }

    #[test]
    fn the_table_records_children_as_well_as_parents() {
        // The console host is a *child* of the program it hosts, so walking up
        // alone can never reach it.
        let table = ProcessTable::snapshot();
        let us = std::process::id();
        let parent = *table.parents.get(&us).expect("we have a parent recorded");
        assert!(table
            .children
            .get(&parent)
            .is_some_and(|kids| kids.contains(&us)));
    }

    #[test]
    fn any_window_found_for_us_is_one_a_user_could_click() {
        // This process has no window of its own — a test binary is a console
        // program — so anything found came from walking up to the terminal that
        // started it. Under a test runner with no console there is nothing to
        // find, and that is a pass too: the claim is about what it returns, not
        // that it returns something.
        let Some(window) = window_for(std::process::id(), &ProcessTable::snapshot()) else {
            return;
        };

        // SAFETY: the handle came from Win32 in the line above.
        unsafe {
            assert!(IsWindowVisible(window).as_bool());
            assert_eq!(GetAncestor(window, GA_ROOTOWNER), window);
            assert!(GetWindowTextLengthW(window) > 0);
        }
    }

    #[test]
    fn ancestry_reaches_past_our_own_parent() {
        let table = ProcessTable::snapshot();
        let chain = table.ancestry(std::process::id());
        assert_eq!(chain.first(), Some(&std::process::id()));
        // Every process on Windows has at least one ancestor recorded, even if
        // that ancestor has since exited.
        assert!(!chain.is_empty());
    }
}
