# Окно для записи ключей на сервер (вместо `ssh -t lavochka lavochka-secret ИМЯ`).
# Запуск — двойной щелчок по secret-gui.cmd рядом. Значение уходит по SSH во вход
# lavochka-secret и нигде не сохраняется: ни в истории, ни на диске этого компьютера.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$main = '/etc/lavochka.env'
$backup = '/etc/lavochka-backup.env'
$keys = @(
  @{ n = 'YANDEX_CLIENT_ID';     f = $main;   d = 'Яндекс ID — ClientID приложения' },
  @{ n = 'YANDEX_CLIENT_SECRET'; f = $main;   d = 'Яндекс ID — Client secret' },
  @{ n = 'VK_APP_ID';            f = $main;   d = 'VK ID — ID приложения' },
  @{ n = 'VK_CLIENT_SECRET';     f = $main;   d = 'VK ID — защищённый ключ' },
  @{ n = 'VK_SERVICE_KEY';       f = $main;   d = 'VK ID — сервисный ключ доступа' },
  @{ n = 'UNISENDER_API_KEY';    f = $main;   d = 'Unisender Go — API-ключ' },
  @{ n = 'ROBOKASSA_LOGIN';      f = $main;   d = 'Robokassa — идентификатор магазина (lavochka-games)' },
  @{ n = 'ROBOKASSA_PASS1';      f = $main;   d = 'Robokassa — Пароль #1 (в тесте — тестовый)' },
  @{ n = 'ROBOKASSA_PASS2';      f = $main;   d = 'Robokassa — Пароль #2 (в тесте — тестовый)' },
  @{ n = 'ROBOKASSA_HASH';       f = $main;   d = 'Robokassa — алгоритм хеша: md5 или sha256' },
  @{ n = 'ROBOKASSA_TEST';       f = $main;   d = 'Robokassa — тестовый режим: 1 — тест, 0 — боевой' },
  @{ n = 'ROUTERAI_API_KEY';     f = $main;   d = 'routerai.ru — ключ API (Совет Михалыча в шахматном кружке)' },
  @{ n = 'YADISK_TOKEN';         f = $backup; d = 'Яндекс Диск — токен (бэкапы)' }
)

function Invoke-Ssh([string]$cmd, [string]$stdin) {
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo.FileName = 'ssh'
  $p.StartInfo.Arguments = "-o BatchMode=yes -o ConnectTimeout=15 lavochka `"$cmd`""
  $p.StartInfo.UseShellExecute = $false
  $p.StartInfo.CreateNoWindow = $true
  $p.StartInfo.RedirectStandardInput = $true
  $p.StartInfo.RedirectStandardOutput = $true
  $p.StartInfo.RedirectStandardError = $true
  $p.StartInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $p.StartInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
  # .NET пишет BOM во вход процесса, если кодировка консоли — UTF-8 с BOM
  try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
  [void]$p.Start()
  if ($stdin) {
    # байтами, без BOM, который .NET иначе ставит в начало
    $b = (New-Object System.Text.UTF8Encoding $false).GetBytes($stdin + "`n")
    $p.StandardInput.BaseStream.Write($b, 0, $b.Length)
  }
  $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return @{ code = $p.ExitCode; text = $out.Trim() }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Ключи на сервер — Вечером на лавочке'
$form.Size = New-Object System.Drawing.Size(560, 430)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

function Add-Label($text, $y) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text; $l.Location = New-Object System.Drawing.Point(16, $y); $l.AutoSize = $true
  $form.Controls.Add($l)
}

Add-Label 'Какой ключ' 14
$combo = New-Object System.Windows.Forms.ComboBox
$combo.DropDownStyle = 'DropDownList'
$combo.Location = New-Object System.Drawing.Point(16, 38); $combo.Width = 510
foreach ($k in $keys) { [void]$combo.Items.Add("$($k.d)   ($($k.n))") }
$combo.SelectedIndex = 0
$form.Controls.Add($combo)

Add-Label 'Значение (Ctrl+V)' 76
$box = New-Object System.Windows.Forms.TextBox
$box.Location = New-Object System.Drawing.Point(16, 100); $box.Width = 510
$box.UseSystemPasswordChar = $true
$form.Controls.Add($box)

$show = New-Object System.Windows.Forms.CheckBox
$show.Text = 'Показать'; $show.Location = New-Object System.Drawing.Point(16, 132); $show.AutoSize = $true
$show.Add_CheckedChanged({ $box.UseSystemPasswordChar = -not $show.Checked })
$form.Controls.Add($show)

$paste = New-Object System.Windows.Forms.Button
$paste.Text = 'Вставить из буфера'; $paste.Location = New-Object System.Drawing.Point(366, 128); $paste.Width = 160
$paste.Add_Click({ $box.Text = ([System.Windows.Forms.Clipboard]::GetText()).Trim() })
$form.Controls.Add($paste)

$save = New-Object System.Windows.Forms.Button
$save.Text = 'Записать на сервер'; $save.Location = New-Object System.Drawing.Point(16, 172); $save.Width = 200; $save.Height = 34
$form.Controls.Add($save)
$form.AcceptButton = $save

$check = New-Object System.Windows.Forms.Button
$check.Text = 'Что уже записано'; $check.Location = New-Object System.Drawing.Point(326, 172); $check.Width = 200; $check.Height = 34
$form.Controls.Add($check)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'
$log.Location = New-Object System.Drawing.Point(16, 220); $log.Size = New-Object System.Drawing.Size(510, 150)
$form.Controls.Add($log)

function Say($t) { $log.AppendText($t + "`r`n") }

$save.Add_Click({
  $k = $keys[$combo.SelectedIndex]
  $v = $box.Text.Trim()
  if (-not $v) { Say 'Значение пустое — нечего записывать.'; return }
  if ($v -match '\s') { Say 'В значении есть пробел или перенос строки — проверьте, что скопировали только ключ.'; return }
  $form.Cursor = 'WaitCursor'; $save.Enabled = $false
  $r = Invoke-Ssh "lavochka-secret $($k.n) $($k.f)" $v
  $form.Cursor = 'Default'; $save.Enabled = $true
  if ($r.code -eq 0) {
    Say "✔ $($k.n): записано ($($v.Length) знаков, …$($v.Substring([Math]::Max(0, $v.Length - 3))))."
    $box.Clear(); $show.Checked = $false
  } else {
    Say "✖ $($k.n): ошибка (код $($r.code)). $($r.text)"
  }
})

$check.Add_Click({
  $form.Cursor = 'WaitCursor'
  $r = Invoke-Ssh "for f in $main $backup; do echo == `$f; [ -f `$f ] && sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' `$f; done" ''
  $form.Cursor = 'Default'
  if ($r.code -ne 0) { Say "✖ Не удалось связаться с сервером. $($r.text)"; return }
  $have = $r.text -split "`n" | ForEach-Object { $_.Trim() }
  foreach ($k in $keys) {
    $mark = if ($have -contains $k.n) { '✔' } else { '·' }
    Say "$mark $($k.d)"
  }
  Say ''
})

[void]$form.ShowDialog()
