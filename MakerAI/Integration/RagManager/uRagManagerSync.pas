unit uRagManagerSync;

interface

uses
  Winapi.Windows, System.SysUtils;

function QuoteArg(const S: string): string;
function BuildSelfCmd: string;
function BuildExportCmd(const SelfCmd, DbPath, JsonPath, Name, Description: string): string;
function BuildImportCmd(const SelfCmd, DbPath, JsonPath: string; Replace: Boolean): string;
function RunCmdAndWait(const CmdLine: string; const WorkDir: string = ''): Cardinal;

implementation

function QuoteArg(const S: string): string;
begin
  if (S = '') then
    Exit('""');
  if (Pos(' ', S) > 0) or (Pos(#9, S) > 0) or (Pos('"', S) > 0) then
    Result := '"' + StringReplace(S, '"', '\"', [rfReplaceAll]) + '"'
  else
    Result := S;
end;

function BuildSelfCmd: string;
begin
  Result := QuoteArg(ParamStr(0));
end;

function BuildExportCmd(const SelfCmd, DbPath, JsonPath, Name, Description: string): string;
var
  DescPart: string;
begin
  DescPart := '';
  if Description <> '' then
    DescPart := ' --description ' + QuoteArg(Description);
  Result :=
    SelfCmd +
    ' rag export-makerai' +
    ' --db ' + QuoteArg(DbPath) +
    ' -o ' + QuoteArg(JsonPath) +
    ' --name ' + QuoteArg(Name) +
    DescPart;
end;

function BuildImportCmd(const SelfCmd, DbPath, JsonPath: string; Replace: Boolean): string;
var
  ReplacePart: string;
begin
  ReplacePart := '';
  if Replace then
    ReplacePart := ' --replace';
  Result :=
    SelfCmd +
    ' rag import-makerai ' + QuoteArg(JsonPath) +
    ' --db ' + QuoteArg(DbPath) +
    ReplacePart;
end;

function RunCmdAndWait(const CmdLine: string; const WorkDir: string): Cardinal;
var
  SI: TStartupInfoW;
  PI: TProcessInformation;
  CmdBuf: string;
  ExitCode: Cardinal;
begin
  ZeroMemory(@SI, SizeOf(SI));
  SI.cb := SizeOf(SI);
  ZeroMemory(@PI, SizeOf(PI));

  // Use cmd.exe so the passed command line can include quoted args safely.
  CmdBuf := 'cmd.exe /c ' + CmdLine;

  if not CreateProcessW(
    nil,
    PWideChar(WideString(CmdBuf)),
    nil,
    nil,
    False,
    CREATE_NO_WINDOW,
    nil,
    PWideChar(WideString(WorkDir)),
    SI,
    PI
  ) then
    raise Exception.CreateFmt('Failed to start command (err=%d): %s', [GetLastError, CmdLine]);

  try
    WaitForSingleObject(PI.hProcess, INFINITE);
    if not GetExitCodeProcess(PI.hProcess, ExitCode) then
      ExitCode := 1;
    Result := ExitCode;
  finally
    CloseHandle(PI.hThread);
    CloseHandle(PI.hProcess);
  end;
end;

end.

