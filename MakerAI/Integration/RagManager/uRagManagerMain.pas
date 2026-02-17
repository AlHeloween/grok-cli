unit uRagManagerMain;

interface

uses
  Winapi.Windows,
  System.SysUtils,
  System.Classes,
  System.JSON,
  System.UITypes,
  System.IOUtils,
  Vcl.Controls,
  Vcl.StdCtrls,
  Vcl.ExtCtrls,
  Vcl.Forms,
  Vcl.Dialogs,
  uMakerAi.RAG.Vectors,
  uMakerAi.Chat.OpenAi,
  uRagManagerSync;

type
  TRagManagerForm = class(TForm)
  private
    FJsonPath: string;
    FDbPath: string;
    FSelfCmd: string;
    FApplyCmd: string;
    FRefreshCmd: string;
    FSmoke: Boolean;
    FSmokeLog: string;

    FRag: TAiRAGVector;
    FEmbeddings: TAiOpenAiEmbeddings;

    PanelTop: TPanel;
    PanelLeft: TPanel;
    PanelRight: TPanel;
    PanelBottom: TPanel;

    BtnRefresh: TButton;
    BtnApply: TButton;
    BtnSaveJson: TButton;
    BtnLoadJson: TButton;
    BtnReEmbed: TButton;
    BtnAdd: TButton;
    BtnDelete: TButton;

    ListItems: TListBox;
    EdPath: TEdit;
    MemoText: TMemo;
    MemoMeta: TMemo;
    LabPath: TLabel;
    LabText: TLabel;
    LabMeta: TLabel;
    Status: TLabel;

    procedure ParseArgs;
procedure SetStatus(const S: string);
procedure RunSmoke;
procedure FreeRagAndItems;
procedure ResetRag;
procedure LoadJson(const Path: string);
procedure SaveJson(const Path: string);
procedure RefreshList;
    function SelectedNode: TAiEmbeddingNode;
    procedure LoadSelectedToEditor;
    procedure SaveEditorToSelected(ReEmbed: Boolean);
    procedure EnsureEmbeddingsConfigured;

    procedure OnListClick(Sender: TObject);
    procedure OnRefreshClick(Sender: TObject);
    procedure OnApplyClick(Sender: TObject);
    procedure OnSaveJsonClick(Sender: TObject);
    procedure OnLoadJsonClick(Sender: TObject);
    procedure OnReEmbedClick(Sender: TObject);
    procedure OnAddClick(Sender: TObject);
    procedure OnDeleteClick(Sender: TObject);
  public
    constructor Create(AOwner: TComponent); override;
    destructor Destroy; override;
  end;

var
  RagManagerForm: TRagManagerForm;

implementation

{$R *.dfm}

constructor TRagManagerForm.Create(AOwner: TComponent);
begin
  inherited;
  Caption := 'Grok RAG Manager (MakerAI)';
  Width := 1200;
  Height := 800;

  FRag := TAiRAGVector.Create(Self);
FEmbeddings := TAiOpenAiEmbeddings.Create(Self);
FRag.Embeddings := FEmbeddings;
FRag.InMemoryIndexType := TAIBasicIndex;

  PanelTop := TPanel.Create(Self);
  PanelTop.Parent := Self;
  PanelTop.Align := alTop;
  PanelTop.Height := 44;

  BtnRefresh := TButton.Create(PanelTop);
  BtnRefresh.Parent := PanelTop;
  BtnRefresh.Left := 8;
  BtnRefresh.Top := 10;
  BtnRefresh.Caption := 'Refresh';
  BtnRefresh.OnClick := OnRefreshClick;

  BtnApply := TButton.Create(PanelTop);
  BtnApply.Parent := PanelTop;
  BtnApply.Left := 92;
  BtnApply.Top := 10;
  BtnApply.Caption := 'Apply';
  BtnApply.OnClick := OnApplyClick;

  BtnSaveJson := TButton.Create(PanelTop);
  BtnSaveJson.Parent := PanelTop;
  BtnSaveJson.Left := 176;
  BtnSaveJson.Top := 10;
  BtnSaveJson.Caption := 'Save JSON';
  BtnSaveJson.OnClick := OnSaveJsonClick;

  BtnLoadJson := TButton.Create(PanelTop);
  BtnLoadJson.Parent := PanelTop;
  BtnLoadJson.Left := 268;
  BtnLoadJson.Top := 10;
  BtnLoadJson.Caption := 'Load JSON';
  BtnLoadJson.OnClick := OnLoadJsonClick;

  BtnReEmbed := TButton.Create(PanelTop);
  BtnReEmbed.Parent := PanelTop;
  BtnReEmbed.Left := 360;
  BtnReEmbed.Top := 10;
  BtnReEmbed.Caption := 'Re-embed selected';
  BtnReEmbed.OnClick := OnReEmbedClick;

  BtnAdd := TButton.Create(PanelTop);
  BtnAdd.Parent := PanelTop;
  BtnAdd.Left := 500;
  BtnAdd.Top := 10;
  BtnAdd.Caption := 'Add';
  BtnAdd.OnClick := OnAddClick;

  BtnDelete := TButton.Create(PanelTop);
  BtnDelete.Parent := PanelTop;
  BtnDelete.Left := 560;
  BtnDelete.Top := 10;
  BtnDelete.Caption := 'Delete';
  BtnDelete.OnClick := OnDeleteClick;

  PanelLeft := TPanel.Create(Self);
  PanelLeft.Parent := Self;
  PanelLeft.Align := alLeft;
  PanelLeft.Width := 420;

  ListItems := TListBox.Create(PanelLeft);
  ListItems.Parent := PanelLeft;
  ListItems.Align := alClient;
  ListItems.OnClick := OnListClick;

  PanelRight := TPanel.Create(Self);
  PanelRight.Parent := Self;
  PanelRight.Align := alClient;

  LabPath := TLabel.Create(PanelRight);
  LabPath.Parent := PanelRight;
  LabPath.Caption := 'Path (json.path):';
  LabPath.Left := 8;
  LabPath.Top := 8;

  EdPath := TEdit.Create(PanelRight);
  EdPath.Parent := PanelRight;
  EdPath.Left := 8;
  EdPath.Top := 26;
  EdPath.Width := 740;

  LabText := TLabel.Create(PanelRight);
  LabText.Parent := PanelRight;
  LabText.Caption := 'Text:';
  LabText.Left := 8;
  LabText.Top := 56;

  MemoText := TMemo.Create(PanelRight);
  MemoText.Parent := PanelRight;
  MemoText.Left := 8;
  MemoText.Top := 74;
  MemoText.Width := 740;
  MemoText.Height := 320;
  MemoText.ScrollBars := ssVertical;

  LabMeta := TLabel.Create(PanelRight);
  LabMeta.Parent := PanelRight;
  LabMeta.Caption := 'Meta (json.meta):';
  LabMeta.Left := 8;
  LabMeta.Top := 404;

  MemoMeta := TMemo.Create(PanelRight);
  MemoMeta.Parent := PanelRight;
  MemoMeta.Left := 8;
  MemoMeta.Top := 422;
  MemoMeta.Width := 740;
  MemoMeta.Height := 260;
  MemoMeta.ScrollBars := ssVertical;

  PanelBottom := TPanel.Create(Self);
  PanelBottom.Parent := Self;
  PanelBottom.Align := alBottom;
  PanelBottom.Height := 28;

  Status := TLabel.Create(PanelBottom);
  Status.Parent := PanelBottom;
  Status.Align := alClient;
  Status.Caption := '';

  ParseArgs;

  if FSmoke then
  begin
    RunSmoke;
    Exit;
  end;

  if (FJsonPath <> '') and FileExists(FJsonPath) then
  begin
    LoadJson(FJsonPath);
    RefreshList;
  end;
end;

destructor TRagManagerForm.Destroy;
begin
  FreeRagAndItems;
  inherited;
end;

procedure TRagManagerForm.SetStatus(const S: string);
begin
  Status.Caption := S;
end;

procedure TRagManagerForm.ParseArgs;
var
  i: Integer;
  k, v: string;
begin
  FSelfCmd := '';
  FApplyCmd := '';
  FRefreshCmd := '';
  FJsonPath := '';
  FDbPath := '';
  FSmoke := False;
  FSmokeLog := '';

  i := 1;
  while i <= ParamCount do
  begin
    k := ParamStr(i);
    if k = '--smoke' then
    begin
      FSmoke := True;
    end
    else if (k = '--smoke-log') and (i < ParamCount) then
    begin
      Inc(i);
      FSmokeLog := ParamStr(i);
    end
    else if (k = '--json') and (i < ParamCount) then
    begin
      Inc(i);
      FJsonPath := ParamStr(i);
    end
    else if (k = '--db') and (i < ParamCount) then
    begin
      Inc(i);
      FDbPath := ParamStr(i);
    end
    else if (k = '--self-cmd') and (i < ParamCount) then
    begin
      Inc(i);
      FSelfCmd := ParamStr(i);
    end
    else if (k = '--apply-cmd') and (i < ParamCount) then
    begin
      Inc(i);
      FApplyCmd := ParamStr(i);
    end
    else if (k = '--refresh-cmd') and (i < ParamCount) then
    begin
      Inc(i);
      FRefreshCmd := ParamStr(i);
    end
    else if (k = '--env-openai-url') and (i < ParamCount) then
    begin
      Inc(i);
      v := ParamStr(i);
      FEmbeddings.Url := v;
    end;
    Inc(i);
  end;

  if FEmbeddings.Url = '' then
  begin
    v := GetEnvironmentVariable('GROK_EMBEDDINGS_BASE_URL');
    if v = '' then
      v := GetEnvironmentVariable('GROK_BASE_URL');
    if v <> '' then
    begin
      if not v.EndsWith('/') then
        v := v + '/';
      if not v.EndsWith('/v1/') then
      begin
        if v.EndsWith('/v1') then
          v := v + '/'
        else
          v := v + 'v1/';
      end;
      FEmbeddings.Url := v;
    end;
  end;

  if FEmbeddings.ApiKey = '' then
  begin
    v := GetEnvironmentVariable('GROK_API_KEY');
    if v <> '' then
      FEmbeddings.ApiKey := v;
  end;
end;

procedure TRagManagerForm.FreeRagAndItems;
var
  i: Integer;
begin
  if not Assigned(FRag) then
    Exit;
  try
    for i := 0 to FRag.Items.Count - 1 do
      FRag.Items[i].Free;
  except
    // ignore cleanup errors
  end;
  FreeAndNil(FRag);
end;

procedure TRagManagerForm.ResetRag;
begin
  FreeRagAndItems;
  FRag := TAiRAGVector.Create(Self);
  FRag.Embeddings := FEmbeddings;
  FRag.InMemoryIndexType := TAIBasicIndex;
end;

procedure TRagManagerForm.RunSmoke;
var
  rc: Cardinal;
  outPath: string;
  jo: TJSONObject;
begin
  if FRefreshCmd <> '' then
  begin
    rc := RunCmdAndWait(FRefreshCmd, GetCurrentDir);
    if rc <> 0 then
      Halt(10);
  end;

  if (FJsonPath = '') or (not FileExists(FJsonPath)) then
    Halt(11);

  try
    LoadJson(FJsonPath);
  except
    Halt(12);
  end;

  outPath := FSmokeLog;
  if outPath = '' then
    outPath := ChangeFileExt(FJsonPath, '.smoke.json');

  jo := TJSONObject.Create;
  try
    jo.AddPair('json', FJsonPath);
    jo.AddPair('count', TJSONNumber.Create(FRag.Count));
    jo.AddPair('dim', TJSONNumber.Create(FRag.Dim));
    jo.AddPair('model', FRag.Model);
    jo.AddPair('name', FRag.NameVec);
    jo.AddPair('description', FRag.Description);
    TFile.WriteAllText(outPath, jo.ToJSON, TEncoding.UTF8);
  finally
    jo.Free;
  end;

  Halt(0);
end;

procedure TRagManagerForm.EnsureEmbeddingsConfigured;
begin
  if (FEmbeddings.ApiKey = '') then
    raise Exception.Create('Missing GROK_API_KEY (needed to re-embed/add items).');
end;

procedure TRagManagerForm.LoadJson(const Path: string);
begin
  ResetRag;
  FRag.LoadFromFile(Path);
  SetStatus(Format('Loaded %d item(s) from %s (dim=%d)', [FRag.Count, Path, FRag.Dim]));
end;

procedure TRagManagerForm.SaveJson(const Path: string);
begin
  FRag.SaveToFile(Path);
  SetStatus('Saved: ' + Path);
end;

procedure TRagManagerForm.RefreshList;
var
  i: Integer;
  node: TAiEmbeddingNode;
  p: string;
begin
  ListItems.Items.BeginUpdate;
  try
    ListItems.Items.Clear;
    for i := 0 to FRag.Items.Count - 1 do
    begin
      node := FRag.Items[i];
      p := '';
      if Assigned(node.jData) then
        node.jData.TryGetValue<string>('path', p);
      ListItems.Items.Add(Format('%d | %s', [i, p]));
    end;
  finally
    ListItems.Items.EndUpdate;
  end;
end;

function TRagManagerForm.SelectedNode: TAiEmbeddingNode;
var
  idx: Integer;
begin
  idx := ListItems.ItemIndex;
  if (idx < 0) or (idx >= FRag.Items.Count) then
    Exit(nil);
  Result := FRag.Items[idx];
end;

procedure TRagManagerForm.LoadSelectedToEditor;
var
  node: TAiEmbeddingNode;
  p, m: string;
begin
  node := SelectedNode;
  if not Assigned(node) then Exit;

  MemoText.Text := node.Text;
  p := '';
  m := '';
  if Assigned(node.jData) then
  begin
    node.jData.TryGetValue<string>('path', p);
    node.jData.TryGetValue<string>('meta', m);
  end;
  EdPath.Text := p;
  MemoMeta.Text := m;
end;

procedure TRagManagerForm.SaveEditorToSelected(ReEmbed: Boolean);
var
  node: TAiEmbeddingNode;
  j: TJSONObject;
  dim: Integer;
begin
  node := SelectedNode;
  if not Assigned(node) then Exit;

  node.Text := MemoText.Text;
  if not Assigned(node.jData) then
    node.jData := TJSONObject.Create;
  j := node.jData;
  j.RemovePair('path');
  j.AddPair('path', EdPath.Text);
  j.RemovePair('meta');
  j.AddPair('meta', MemoMeta.Text);

  if ReEmbed then
  begin
    EnsureEmbeddingsConfigured;
    dim := FRag.Dim;
    if dim <= 0 then
      dim := 1536;
    node.Data := FEmbeddings.CreateEmbedding(node.Text, 'user', dim, '', 'float');
    node.Model := FRag.Model;
  end;
end;

procedure TRagManagerForm.OnListClick(Sender: TObject);
begin
  LoadSelectedToEditor;
end;

procedure TRagManagerForm.OnRefreshClick(Sender: TObject);
var
  rc: Cardinal;
begin
  if FRefreshCmd = '' then
  begin
    SetStatus('No refresh command provided.');
    Exit;
  end;
  rc := RunCmdAndWait(FRefreshCmd, GetCurrentDir);
  if rc <> 0 then
    raise Exception.CreateFmt('Refresh failed (exit=%d)', [rc]);
  if FJsonPath <> '' then
  begin
    LoadJson(FJsonPath);
    RefreshList;
  end;
end;

procedure TRagManagerForm.OnApplyClick(Sender: TObject);
var
  rc: Cardinal;
begin
  if FJsonPath <> '' then
    SaveJson(FJsonPath);
  if FApplyCmd = '' then
  begin
    SetStatus('No apply command provided.');
    Exit;
  end;
  rc := RunCmdAndWait(FApplyCmd, GetCurrentDir);
  if rc <> 0 then
    raise Exception.CreateFmt('Apply failed (exit=%d)', [rc]);
  SetStatus('Applied to DB.');
end;

procedure TRagManagerForm.OnSaveJsonClick(Sender: TObject);
begin
  if FJsonPath = '' then
  begin
    with TSaveDialog.Create(Self) do
    try
      Filter := 'MakerAI RAGVector (*.json)|*.json|All files (*.*)|*.*';
      if Execute then
      begin
        FJsonPath := FileName;
        SaveJson(FJsonPath);
      end;
    finally
      Free;
    end;
  end
  else
    SaveJson(FJsonPath);
end;

procedure TRagManagerForm.OnLoadJsonClick(Sender: TObject);
begin
  with TOpenDialog.Create(Self) do
  try
    Filter := 'MakerAI RAGVector (*.json)|*.json|All files (*.*)|*.*';
    if Execute then
    begin
      FJsonPath := FileName;
      LoadJson(FJsonPath);
      RefreshList;
    end;
  finally
    Free;
  end;
end;

procedure TRagManagerForm.OnReEmbedClick(Sender: TObject);
begin
  SaveEditorToSelected(True);
  if FJsonPath <> '' then
  begin
    SaveJson(FJsonPath);
    LoadJson(FJsonPath);
    RefreshList;
  end;
  SetStatus('Re-embedded selected item.');
end;

procedure TRagManagerForm.OnAddClick(Sender: TObject);
var
  md: TAiEmbeddingMetaData;
  node: TAiEmbeddingNode;
  text: string;
begin
  EnsureEmbeddingsConfigured;
  text := InputBox('Add item', 'Text:', '');
  if Trim(text) = '' then Exit;
  md := TAiEmbeddingMetaData.Create;
  try
    node := FRag.AddItem(text, md);
    if Assigned(node) then
    begin
      if not Assigned(node.jData) then
        node.jData := TJSONObject.Create;
      node.jData.AddPair('path', InputBox('Add item', 'Path (json.path):', ''));
      node.jData.AddPair('meta', '');
    end;
  finally
    md.Free;
  end;

  if FJsonPath <> '' then
  begin
    SaveJson(FJsonPath);
    LoadJson(FJsonPath);
  end;
  RefreshList;
end;

procedure TRagManagerForm.OnDeleteClick(Sender: TObject);
var
  idx: Integer;
  node: TAiEmbeddingNode;
begin
  if FJsonPath = '' then
  begin
    SetStatus('No JSON path loaded; cannot delete safely.');
    Exit;
  end;

  idx := ListItems.ItemIndex;
  if (idx < 0) or (idx >= FRag.Items.Count) then Exit;
  if MessageDlg('Delete selected item?', mtConfirmation, [mbYes, mbNo], 0) <> mrYes then
    Exit;

  node := FRag.Items[idx];
  FRag.Items.Delete(idx);
  SaveJson(FJsonPath);

  // ResetRag inside LoadJson frees the old in-memory index state. Free the removed node afterwards.
  LoadJson(FJsonPath);
  node.Free;

  RefreshList;
  MemoText.Clear;
  MemoMeta.Clear;
  EdPath.Text := '';
end;

end.

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\MakerAI/Integration/RagManager/uRagManagerMain.pas"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\MakerAI/Integration/RagManager/uRagManagerMain.pas.backup_20260217T231317_346504"
//   "created_at": "2026-02-17T15:13:17.356444+00:00"
//   "backup_hash": "7bffb8da687f00afac8a33f4bc647b09"
//   "new_hash": "0203577df4377d2bb5e6366ce833d93e"
//   "goal_id": "ragmanager_use_basic_index_on_reset"
//   "semantics": "Ensure ResetRag creates a non-HNSW vector and fix missing newline between procedures."
//   "update_attrs": {"relative_path": "MakerAI/Integration/RagManager/uRagManagerMain.pas", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "procedure TRagManagerForm.ResetRag;\nbegin\n  FreeRagAndItems;\n  FRag := TAiRAGVector.Create(Self);\n  FRag.Embeddings := FEmbeddings;\nend;procedure TRagManagerForm.RunSmoke;", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\MakerAI/Integration/RagManager/uRagManagerMain.pas\""
// }
