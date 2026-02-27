from __future__ import annotations

import os
import subprocess
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from ..util import require


if os.name != "nt":
    raise RuntimeError("windows_conpty backend imported on non-Windows")


import ctypes
from ctypes import wintypes

HRESULT = getattr(wintypes, "HRESULT", ctypes.c_long)


# ---- WinAPI constants ----
ERROR_IO_PENDING = 997

STARTF_USESTDHANDLES = 0x00000100
EXTENDED_STARTUPINFO_PRESENT = 0x00080000
CREATE_UNICODE_ENVIRONMENT = 0x00000400
CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_NEW_CONSOLE = 0x00000010

PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016

HANDLE_FLAG_INHERIT = 0x00000001

IDLE_PRIORITY_CLASS = 0x00000040

WAIT_OBJECT_0 = 0x00000000
WAIT_TIMEOUT = 0x00000102

JobObjectExtendedLimitInformation = 9
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000


# ---- Types ----
HPCON = ctypes.c_void_p


class COORD(ctypes.Structure):
    _fields_ = [("X", wintypes.SHORT), ("Y", wintypes.SHORT)]


class SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ("nLength", wintypes.DWORD),
        ("lpSecurityDescriptor", wintypes.LPVOID),
        ("bInheritHandle", wintypes.BOOL),
    ]


class STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("lpReserved", wintypes.LPWSTR),
        ("lpDesktop", wintypes.LPWSTR),
        ("lpTitle", wintypes.LPWSTR),
        ("dwX", wintypes.DWORD),
        ("dwY", wintypes.DWORD),
        ("dwXSize", wintypes.DWORD),
        ("dwYSize", wintypes.DWORD),
        ("dwXCountChars", wintypes.DWORD),
        ("dwYCountChars", wintypes.DWORD),
        ("dwFillAttribute", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("wShowWindow", wintypes.WORD),
        ("cbReserved2", wintypes.WORD),
        ("lpReserved2", ctypes.POINTER(ctypes.c_byte)),
        ("hStdInput", wintypes.HANDLE),
        ("hStdOutput", wintypes.HANDLE),
        ("hStdError", wintypes.HANDLE),
    ]


class STARTUPINFOEX(ctypes.Structure):
    _fields_ = [("StartupInfo", STARTUPINFO), ("lpAttributeList", wintypes.LPVOID)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("hProcess", wintypes.HANDLE),
        ("hThread", wintypes.HANDLE),
        ("dwProcessId", wintypes.DWORD),
        ("dwThreadId", wintypes.DWORD),
    ]


class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
        ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_ulonglong),
        ("WriteOperationCount", ctypes.c_ulonglong),
        ("OtherOperationCount", ctypes.c_ulonglong),
        ("ReadTransferCount", ctypes.c_ulonglong),
        ("WriteTransferCount", ctypes.c_ulonglong),
        ("OtherTransferCount", ctypes.c_ulonglong),
    ]


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

# Function prototypes
CreatePipe = kernel32.CreatePipe
CreatePipe.argtypes = [ctypes.POINTER(wintypes.HANDLE), ctypes.POINTER(wintypes.HANDLE), ctypes.POINTER(SECURITY_ATTRIBUTES), wintypes.DWORD]
CreatePipe.restype = wintypes.BOOL

SetHandleInformation = kernel32.SetHandleInformation
SetHandleInformation.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD]
SetHandleInformation.restype = wintypes.BOOL

ReadFile = kernel32.ReadFile
ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
ReadFile.restype = wintypes.BOOL

PeekNamedPipe = kernel32.PeekNamedPipe
PeekNamedPipe.argtypes = [
    wintypes.HANDLE,
    wintypes.LPVOID,
    wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD),
    ctypes.POINTER(wintypes.DWORD),
    ctypes.POINTER(wintypes.DWORD),
]
PeekNamedPipe.restype = wintypes.BOOL

WriteFile = kernel32.WriteFile
WriteFile.argtypes = [wintypes.HANDLE, wintypes.LPCVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
WriteFile.restype = wintypes.BOOL

CloseHandle = kernel32.CloseHandle
CloseHandle.argtypes = [wintypes.HANDLE]
CloseHandle.restype = wintypes.BOOL

WaitForSingleObject = kernel32.WaitForSingleObject
WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
WaitForSingleObject.restype = wintypes.DWORD

GetExitCodeProcess = kernel32.GetExitCodeProcess
GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
GetExitCodeProcess.restype = wintypes.BOOL

ResumeThread = kernel32.ResumeThread
ResumeThread.argtypes = [wintypes.HANDLE]
ResumeThread.restype = wintypes.DWORD

SetPriorityClass = kernel32.SetPriorityClass
SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
SetPriorityClass.restype = wintypes.BOOL

CreateJobObjectW = kernel32.CreateJobObjectW
CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
CreateJobObjectW.restype = wintypes.HANDLE

SetInformationJobObject = kernel32.SetInformationJobObject
SetInformationJobObject.argtypes = [wintypes.HANDLE, wintypes.INT, wintypes.LPVOID, wintypes.DWORD]
SetInformationJobObject.restype = wintypes.BOOL

AssignProcessToJobObject = kernel32.AssignProcessToJobObject
AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
AssignProcessToJobObject.restype = wintypes.BOOL

TerminateJobObject = kernel32.TerminateJobObject
TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
TerminateJobObject.restype = wintypes.BOOL

InitializeProcThreadAttributeList = kernel32.InitializeProcThreadAttributeList
InitializeProcThreadAttributeList.argtypes = [wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_size_t)]
InitializeProcThreadAttributeList.restype = wintypes.BOOL

UpdateProcThreadAttribute = kernel32.UpdateProcThreadAttribute
UpdateProcThreadAttribute.argtypes = [wintypes.LPVOID, wintypes.DWORD, ctypes.c_size_t, wintypes.LPVOID, ctypes.c_size_t, wintypes.LPVOID, wintypes.LPVOID]
UpdateProcThreadAttribute.restype = wintypes.BOOL

DeleteProcThreadAttributeList = kernel32.DeleteProcThreadAttributeList
DeleteProcThreadAttributeList.argtypes = [wintypes.LPVOID]
DeleteProcThreadAttributeList.restype = None

CreateProcessW = kernel32.CreateProcessW
CreateProcessW.argtypes = [
    wintypes.LPCWSTR,  # lpApplicationName
    wintypes.LPWSTR,   # lpCommandLine
    wintypes.LPVOID,   # lpProcessAttributes
    wintypes.LPVOID,   # lpThreadAttributes
    wintypes.BOOL,     # bInheritHandles
    wintypes.DWORD,    # dwCreationFlags
    wintypes.LPVOID,   # lpEnvironment
    wintypes.LPCWSTR,  # lpCurrentDirectory
    ctypes.POINTER(STARTUPINFOEX),  # lpStartupInfo
    ctypes.POINTER(PROCESS_INFORMATION),  # lpProcessInformation
]
CreateProcessW.restype = wintypes.BOOL

# ConPTY APIs: CreatePseudoConsole / ClosePseudoConsole
_CONPTY_AVAILABLE = True
try:
    CreatePseudoConsole = kernel32.CreatePseudoConsole
    ClosePseudoConsole = kernel32.ClosePseudoConsole
except AttributeError:
    _CONPTY_AVAILABLE = False
    CreatePseudoConsole = None  # type: ignore[assignment]
    ClosePseudoConsole = None  # type: ignore[assignment]

ResizePseudoConsole = getattr(kernel32, "ResizePseudoConsole", None)

if _CONPTY_AVAILABLE:
    assert CreatePseudoConsole is not None
    assert ClosePseudoConsole is not None
    CreatePseudoConsole.argtypes = [
        COORD,
        wintypes.HANDLE,
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(HPCON),
    ]
    CreatePseudoConsole.restype = HRESULT  # HRESULT

    if ResizePseudoConsole is not None:
        ResizePseudoConsole.argtypes = [HPCON, COORD]
        ResizePseudoConsole.restype = HRESULT

    ClosePseudoConsole.argtypes = [HPCON]
    ClosePseudoConsole.restype = None


def conpty_available() -> bool:
    return bool(_CONPTY_AVAILABLE)


def require_conpty() -> None:
    if not conpty_available():
        raise RuntimeError("ConPTY is unavailable on this Windows build (requires Windows 10 1809+).")


def _winerr(msg: str) -> RuntimeError:
    err = ctypes.get_last_error()
    return RuntimeError(f"{msg} (WinError={err})")


def _create_pipe(inheritable: bool) -> tuple[int, int]:
    sa = SECURITY_ATTRIBUTES()
    sa.nLength = ctypes.sizeof(SECURITY_ATTRIBUTES)
    sa.lpSecurityDescriptor = None
    sa.bInheritHandle = bool(inheritable)
    r = wintypes.HANDLE()
    w = wintypes.HANDLE()
    ok = CreatePipe(ctypes.byref(r), ctypes.byref(w), ctypes.byref(sa), 0)
    if not ok:
        raise _winerr("CreatePipe failed")
    return int(r.value), int(w.value)


def _set_no_inherit(h: int) -> None:
    ok = SetHandleInformation(wintypes.HANDLE(h), HANDLE_FLAG_INHERIT, 0)
    if not ok:
        raise _winerr("SetHandleInformation failed")


def _build_env_block(env: Dict[str, str]) -> ctypes.Array:
    # Windows requires sorted, case-insensitive env block, double-NUL terminated.
    items = [f"{k}={v}" for k, v in env.items()]
    items.sort(key=lambda s: s.split("=", 1)[0].upper())
    block = "\x00".join(items) + "\x00\x00"
    return ctypes.create_unicode_buffer(block)


@dataclass
class WindowsConPTYHandles:
    pid: int
    h_process: int
    h_thread: int
    h_job: int
    h_pcon: int
    h_in_write: int
    h_out_read: int


class WindowsConPTYSession:
    def __init__(
        self,
        *,
        argv: List[str],
        cwd: str,
        env: Dict[str, str],
        cols: int,
        rows: int,
        low_priority: bool,
    ) -> None:
        self._argv = argv
        self._cwd = cwd
        self._env = env
        self._cols = cols
        self._rows = rows
        self._low_priority = low_priority

        self._handles: Optional[WindowsConPTYHandles] = None
        self._exit_code: Optional[int] = None


    @property
    def pid(self) -> int:
        if self._handles is None:
            raise RuntimeError("Session not started")
        return self._handles.pid


    def start(self) -> WindowsConPTYHandles:
        require_conpty()
        # Create pipes
        h_in_read, h_in_write = _create_pipe(inheritable=True)
        h_out_read, h_out_write = _create_pipe(inheritable=True)

        # Parent ends should not be inheritable
        _set_no_inherit(h_in_write)
        _set_no_inherit(h_out_read)

        # Create pseudoconsole
        size = COORD(self._cols, self._rows)
        hpcon = HPCON()
        assert CreatePseudoConsole is not None
        hr = CreatePseudoConsole(
            size,
            wintypes.HANDLE(h_in_read),
            wintypes.HANDLE(h_out_write),
            0,
            ctypes.byref(hpcon),
        )
        if int(hr) != 0:
            raise RuntimeError(f"CreatePseudoConsole failed (HRESULT={int(hr)})")

        # Once created, close our duplicates of the ends handed to the pseudoconsole.
        # We keep only the ends used by the controller (write->stdin, read<-stdout).
        CloseHandle(wintypes.HANDLE(h_in_read))
        CloseHandle(wintypes.HANDLE(h_out_write))

        # Create attribute list for pseudoconsole
        attr_size = ctypes.c_size_t(0)
        ok = InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(attr_size))
        if not ok and ctypes.get_last_error() != 122:  # ERROR_INSUFFICIENT_BUFFER
            raise _winerr("InitializeProcThreadAttributeList (size query) failed")

        attr_buf = ctypes.create_string_buffer(attr_size.value)
        attr_list = ctypes.cast(attr_buf, wintypes.LPVOID)
        ok = InitializeProcThreadAttributeList(attr_list, 1, 0, ctypes.byref(attr_size))
        if not ok:
            raise _winerr("InitializeProcThreadAttributeList failed")

        # Update attribute list with pseudoconsole handle
        ok = UpdateProcThreadAttribute(
            attr_list,
            0,
            ctypes.c_size_t(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE),
            hpcon,
            ctypes.sizeof(HPCON),
            None,
            None,
        )
        if not ok:
            DeleteProcThreadAttributeList(attr_list)
            raise _winerr("UpdateProcThreadAttribute failed")

        # Prepare startup info
        si_ex = STARTUPINFOEX()
        si_ex.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEX)
        si_ex.lpAttributeList = attr_list

        # Build command line + env
        cmdline = subprocess.list2cmdline(self._argv)
        env_block = _build_env_block(self._env)

        pi = PROCESS_INFORMATION()

        # NOTE: Do not use CREATE_NO_WINDOW here. With ConPTY, a console window is not created,
        # and CREATE_NO_WINDOW can break console attachment and stdout/stderr capture.
        #
        # ConPTY attaches the child process to a pseudoconsole; avoid DETACHED_PROCESS here.
        # DETACHED_PROCESS can break console-mode programs (e.g. `cmd.exe ... pause`) and cause
        # immediate non-interactive exit.
        flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT

        ok = CreateProcessW(
            None,
            ctypes.create_unicode_buffer(cmdline),
            None,
            None,
            False,
            flags,
            ctypes.cast(env_block, wintypes.LPVOID),
            self._cwd,
            ctypes.byref(si_ex),
            ctypes.byref(pi),
        )
        if not ok:
            DeleteProcThreadAttributeList(attr_list)
            assert ClosePseudoConsole is not None
            ClosePseudoConsole(hpcon)
            CloseHandle(wintypes.HANDLE(h_in_write))
            CloseHandle(wintypes.HANDLE(h_out_read))
            raise _winerr("CreateProcessW failed")

        # Job object for kill-on-close tree cleanup
        h_job = CreateJobObjectW(None, None)
        if not h_job:
            raise _winerr("CreateJobObjectW failed")

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        ok = SetInformationJobObject(h_job, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info))
        if not ok:
            raise _winerr("SetInformationJobObject failed")

        ok = AssignProcessToJobObject(h_job, pi.hProcess)
        if not ok:
            raise _winerr("AssignProcessToJobObject failed")

        if self._low_priority:
            ok = SetPriorityClass(pi.hProcess, IDLE_PRIORITY_CLASS)
            if not ok:
                raise _winerr("SetPriorityClass failed")

        DeleteProcThreadAttributeList(attr_list)

        handles = WindowsConPTYHandles(
            pid=int(pi.dwProcessId),
            h_process=int(pi.hProcess),
            h_thread=int(pi.hThread),
            h_job=int(h_job),
            h_pcon=int(hpcon.value),
            h_in_write=int(h_in_write),
            h_out_read=int(h_out_read),
        )
        self._handles = handles
        return handles


    def read(self, max_bytes: int = 65536) -> bytes:
        if self._handles is None:
            raise RuntimeError("Session not started")
        # Blocking read: the IO loop runs in a dedicated thread, so we don't need PeekNamedPipe.
        # PeekNamedPipe can report 0 bytes for ConPTY output in some environments; ReadFile is
        # the simplest reliable drain mechanism.
        buf = ctypes.create_string_buffer(int(max_bytes))
        read_n = wintypes.DWORD(0)
        ok = ReadFile(wintypes.HANDLE(self._handles.h_out_read), buf, int(max_bytes), ctypes.byref(read_n), None)
        if not ok:
            err = ctypes.get_last_error()
            if err in (109, 6, 232):  # ERROR_BROKEN_PIPE / ERROR_INVALID_HANDLE / ERROR_NO_DATA
                return b""
            raise _winerr("ReadFile failed")
        return buf.raw[: read_n.value]


    def write(self, data: bytes) -> int:
        if self._handles is None:
            raise RuntimeError("Session not started")
        written = wintypes.DWORD(0)
        ok = WriteFile(wintypes.HANDLE(self._handles.h_in_write), data, len(data), ctypes.byref(written), None)
        if not ok:
            err = ctypes.get_last_error()
            if err in (109, 232):  # broken pipe
                return 0
            raise _winerr("WriteFile failed")
        return int(written.value)


    def poll_exit(self) -> Optional[int]:
        if self._handles is None:
            return self._exit_code
        if self._exit_code is not None:
            return self._exit_code

        code = wintypes.DWORD(0)
        ok = GetExitCodeProcess(wintypes.HANDLE(self._handles.h_process), ctypes.byref(code))
        if not ok:
            raise _winerr("GetExitCodeProcess failed")
        STILL_ACTIVE = 259
        if int(code.value) == STILL_ACTIVE:
            return None
        self._exit_code = int(code.value)
        return self._exit_code


    def wait(self, timeout_s: Optional[float]) -> Optional[int]:
        if self._handles is None:
            return self._exit_code
        if self._exit_code is not None:
            return self._exit_code

        ms = 0xFFFFFFFF if timeout_s is None else int(timeout_s * 1000)
        res = WaitForSingleObject(wintypes.HANDLE(self._handles.h_process), ms)
        if res == WAIT_TIMEOUT:
            return None
        if res != WAIT_OBJECT_0:
            raise _winerr(f"WaitForSingleObject failed (res={res})")

        return self.poll_exit()


    def terminate_tree(self) -> None:
        if self._handles is None:
            return
        ok = TerminateJobObject(wintypes.HANDLE(self._handles.h_job), 1)
        if not ok:
            raise _winerr("TerminateJobObject failed")

    def close_pseudoconsole(self) -> None:
        if self._handles is None:
            return
        if int(self._handles.h_pcon) == 0:
            return
        assert ClosePseudoConsole is not None
        ClosePseudoConsole(HPCON(self._handles.h_pcon))
        # Keep pipes open so the reader thread can drain remaining bytes.
        self._handles = WindowsConPTYHandles(
            pid=self._handles.pid,
            h_process=self._handles.h_process,
            h_thread=self._handles.h_thread,
            h_job=self._handles.h_job,
            h_pcon=0,
            h_in_write=self._handles.h_in_write,
            h_out_read=self._handles.h_out_read,
        )

    def resize(self, cols: int, rows: int) -> None:
        if self._handles is None:
            return
        if int(self._handles.h_pcon) == 0:
            return
        if ResizePseudoConsole is None:
            return
        size = COORD(int(cols), int(rows))
        hr = ResizePseudoConsole(HPCON(self._handles.h_pcon), size)
        if int(hr) != 0:
            raise RuntimeError(f"ResizePseudoConsole failed (HRESULT={int(hr)})")


    def close(self) -> None:
        if self._handles is None:
            return
        # Close Pseudoconsole first to ensure conhost goes away.
        try:
            assert ClosePseudoConsole is not None
            if int(self._handles.h_pcon) != 0:
                ClosePseudoConsole(HPCON(self._handles.h_pcon))
        finally:
            for h in (self._handles.h_in_write, self._handles.h_out_read, self._handles.h_thread, self._handles.h_process, self._handles.h_job):
                CloseHandle(wintypes.HANDLE(h))
            self._handles = None
