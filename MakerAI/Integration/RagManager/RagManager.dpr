program RagManager;

uses
  Vcl.Forms,
  uRagManagerMain in 'uRagManagerMain.pas',
  uRagManagerSync in 'uRagManagerSync.pas';

begin
  Application.Initialize;
  Application.MainFormOnTaskbar := True;
  Application.CreateForm(TRagManagerForm, RagManagerForm);
  Application.Run;
end.
