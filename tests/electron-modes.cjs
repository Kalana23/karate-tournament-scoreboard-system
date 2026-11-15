const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'karate-modes-test-')));
const errors = [];
let control, arena;
ipcMain.handle('load-buzzer', () => null);
ipcMain.on('broadcast-state-instant', (_, state) => arena?.webContents.send('arena-state-update', state));
ipcMain.on('bunkai-action', (_, action) => control.webContents.send('bunkai-action', action));
const run = code => control.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    for (const file of ['index.html', 'control.html']) {
      const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true } });
      win.webContents.on('console-message', (_, level, message) => { if (level === 3 && !/Failed to load resource|Content Security Policy/.test(message)) errors.push(message); });
      win.webContents.on('render-process-gone', (_, details) => errors.push(JSON.stringify(details)));
      if (file === 'index.html') arena = win; else control = win;
      await win.loadFile(path.join(__dirname, '..', file));
      win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 1920, height: 1080 },
        viewSize: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
        scale: Math.min(win.getContentSize()[0] / 1920, win.getContentSize()[1] / 1080) });
    }
    await delay(1500);
    assert.equal(await run('!!window.TournamentControl && !!document.getElementById("calculate-kata")'), true);
    await run('addPoints("aka", 8)');
    assert.equal(await run('STATE.winner'), 'aka');
    await run('TournamentControl.resetFighter()');
    for (const mode of ['kumite', 'team_kumite', 'kata', 'team_kata']) {
      await run(`TournamentControl.setMode('${mode}')`); await delay(150);
      if (mode.includes('kata')) await run(`document.querySelector('[data-scoring="points"]').click();document.querySelector('[data-judge-count="7"]').click()`);
      assert.equal(await arena.webContents.executeJavaScript('document.body.dataset.mode'), mode);
      const geometry = await run(`JSON.stringify({ height: innerHeight, scroll: document.documentElement.scrollHeight,
        width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
        panels: [...document.querySelectorAll('main > section')].map(el => ({ id:el.id, height:el.clientHeight, scroll:el.scrollHeight })) })`);
      console.log(mode, geometry);
      const g = JSON.parse(geometry); assert.ok(g.scroll <= g.height + 1, 'page overflows');
      assert.ok(g.scrollWidth <= g.width + 1, 'page overflows horizontally');
      for (const p of g.panels) assert.ok(p.scroll <= p.height + 1, mode + ' panel clips: ' + JSON.stringify(p));
      assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-aka-team-wins') === null && document.getElementById('display-ao-team-wins') === null`), true);
      assert.equal(await arena.webContents.executeJavaScript(`getComputedStyle(document.getElementById('arena-team-tracker')).display !== 'none'`), mode === 'team_kumite');
      assert.equal(await run(`getComputedStyle(document.getElementById('btn-aka-yuko')).display !== 'none' && !!document.getElementById('btn-aka-yuko').getClientRects().length`), !mode.includes('kata'));
      const arenaGeometry = JSON.parse(await arena.webContents.executeJavaScript('JSON.stringify({height:innerHeight,scroll:document.documentElement.scrollHeight})'));
      assert.ok(arenaGeometry.scroll <= arenaGeometry.height + 1, 'arena overflows');
      for (const theme of ['light', 'dark']) {
        await run(`if (document.documentElement.classList.contains('${theme === 'light' ? 'dark' : 'light'}')) toggleTheme()`);
        await delay(450);
        const clipped = await run(`(() => {
          const bad = [];
          for (const el of document.querySelectorAll('main input, main select, main button, #timer-display-main, [id^="kata-total-"]')) {
            if (!el.getClientRects().length) continue;
            const r=el.getBoundingClientRect(), panel=el.closest('main > section').getBoundingClientRect();
            if(r.top<panel.top-1 || r.bottom>panel.bottom+1 || r.left<panel.left-1 || r.right>panel.right+1) bad.push(el.id || el.outerHTML.slice(0,100));
          }
          return bad;
        })()`);
        assert.deepEqual(clipped, [], mode + ' clipped controls in ' + theme);
        if (theme === 'light') {
          assert.equal(await run(`getComputedStyle(document.getElementById('bout-number')).color`), 'rgb(15, 23, 42)');
          assert.equal(await run(`getComputedStyle(document.getElementById('aka-score-display')).color`), 'rgb(15, 23, 42)');
          assert.equal(await run(`document.body.classList.contains('light-mode')`), true);
        }
      }
    }
    await run(`TournamentControl.setMode('kumite');document.getElementById('input-ao-name').value='KENJI SATO WITH A VERY LONG COMPETITOR NAME';broadcastState(true)`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript(`(() => {
      const name=document.getElementById('display-ao-name').getBoundingClientRect(), timer=document.getElementById('display-timer').getBoundingClientRect(), category=document.getElementById('display-category').getBoundingClientRect();
      const overlaps=(a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
      return name.left>innerWidth/2 && !overlaps(name,timer) && !overlaps(name,category) && timer.top>name.bottom;
    })()`), true);
    fs.writeFileSync(path.join(os.tmpdir(), 'karate-arena-layout.png'), (await arena.webContents.capturePage({x:0,y:0,width:1920,height:1080})).toPNG());
    await run(`TournamentControl.setMode('kata'); document.querySelector('[data-scoring="flags"]').click();document.querySelector('[data-quick-flags="4"]').click()`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript('document.getElementById("display-aka-score").textContent'), '4');
    await run(`document.querySelector('[data-scoring="points"]').click();document.querySelector('[data-judge-count="5"]').click(); document.querySelectorAll('[data-judge-input]').forEach(el=>{el.value='8.2';el.dispatchEvent(new Event('input'));});document.getElementById('calculate-kata').click()`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript('document.getElementById("display-aka-score").textContent'), '24.6');
    await run(`document.querySelector('[data-judge-count="7"]').click();document.getElementById('calculate-kata').click()`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript('document.getElementById("display-aka-score").textContent'), '41.0');
    assert.equal(await arena.webContents.executeJavaScript('document.querySelectorAll("#arena-judges-aka .dropped").length'), 2);
    await run(`TournamentControl.setMode('team_kata')`);
    await run('toggleTheme()'); await delay(450);
    fs.writeFileSync(path.join(os.tmpdir(), 'karate-control-light-layout.png'), (await control.webContents.capturePage({x:0,y:0,width:1920,height:1080})).toPNG());
    await run('toggleTheme()');
    await arena.webContents.executeJavaScript(`document.querySelector('[data-bunkai-action="start"]').click()`); await delay(180);
    assert.equal(await run('STATE.bunkaiRunning && STATE.bunkaiMs < 300000'), true);
    await run(`TournamentControl.bunkaiAction('stop'); TournamentControl.setMode('team_kumite'); STATE.akaScore=6;STATE.aoScore=2;STATE.winner='aka';TournamentControl.recordBout()`);
    assert.equal(await run('STATE.teamBouts.length === 1 && STATE.akaTeamWins === 1 && STATE.akaScore === 0 && STATE.aoScore === 0'), true);
    assert.deepEqual(errors, []);
    console.log('Electron mode workflow and 1080p layout checks passed.');
    app.exit(0);
  } catch (error) { console.error(error); console.error(errors); app.exit(1); }
});
setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1); }, 55000);
