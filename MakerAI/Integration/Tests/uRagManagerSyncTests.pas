unit uRagManagerSyncTests;

interface

uses
  DUnitX.TestFramework;

type
  [TestFixture]
  TRagManagerSyncTests = class
  public
    [Test]
    procedure QuoteArg_QuotesSpaces;

    [Test]
    procedure BuildImportCmd_IncludesReplace;
  end;

implementation

uses
  System.SysUtils,
  uRagManagerSync;

procedure TRagManagerSyncTests.QuoteArg_QuotesSpaces;
begin
  Assert.AreEqual('"C:\Path With Space\file.json"', QuoteArg('C:\Path With Space\file.json'));
end;

procedure TRagManagerSyncTests.BuildImportCmd_IncludesReplace;
var
  cmd: string;
begin
  cmd := BuildImportCmd('grok', 'C:\db path\rag.db', 'C:\tmp\rag.json', True);
  Assert.IsTrue(cmd.Contains(' import-makerai '));
  Assert.IsTrue(cmd.Contains('--db'));
  Assert.IsTrue(cmd.Contains('--replace'));
end;

initialization
  TDUnitX.RegisterTestFixture(TRagManagerSyncTests);

end.
