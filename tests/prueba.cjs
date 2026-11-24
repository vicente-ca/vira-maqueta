const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

function mockBands() {
  const devices = {};
  window.writes = [];
  window.failSide = '';
  Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{
    async requestDevice({filters,optionalServices}) {
      const name = filters[0].name;
      const side = name.slice(-1);
      // Vira-1 (una pulsera) acepta las dos órdenes. Las demás, solo la de su lado.
      const accepted = side === '1' ? ['L','R'] : [side];
      const device = new EventTarget();
      device.id = name;
      const characteristic = {
        properties:{write:true},
        async writeValueWithResponse(bytes) {
          const command = new TextDecoder().decode(bytes);
          if (!accepted.includes(command) || !device.gatt.connected || window.failSide === side) throw Error('Write failed');
          if (window.hangWrites) return new Promise(() => {});
          window.writes.push(command);
        }
      };
      device.gatt = {
        connected:false,
        async connect() {this.connected=true;return this;},
        async getPrimaryService(id) {
          if (id !== optionalServices[0]) throw Error('Service mismatch');
          return {getCharacteristic:async () => characteristic};
        },
        disconnect() {this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}
      };
      devices[side] = device;
      return device;
    }
  }});
  window.dropBand = side => devices[side].gatt.disconnect();
}

async function run() {
  const browser = await chromium.launch({channel:process.env.VIRA_BROWSER || 'msedge'});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/^https?:/, route => route.abort());
    await page.addInitScript(mockBands);
    await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
    await page.waitForURL('**/prueba.html');
    await page.clock.install();
    async function openScreen(name) {
      if (await page.locator('#' + name).isHidden()) await page.locator('.app-nav a[href="#' + name + '"]').click();
      await page.locator('#' + name).waitFor({state:'visible'});
    }
    async function click(id) {
      await openScreen(/^(connect|test|confirm)[LRS]$/.test(id) ? 'pulseras' : 'prueba');
      await page.locator('#'+id).click();
    }
    const text = id => page.locator('#'+id).innerText();
    async function select(id,value) {
      await openScreen('prueba');
      if (!await page.locator('#settingsDetails').evaluate(d => d.open)) await page.locator('#settingsDetails summary').click();
      await page.locator('#'+id).selectOption(value);
    }
    const records = () => page.evaluate(() => JSON.parse(localStorage.getItem('vira.prueba.v1.' + document.getElementById('history').value)));
    async function pair(side) {
      await click('connect'+side);
      await click('test'+side);
      await page.clock.runFor(2000);
      await click('confirm'+side);
    }
    assert.equal(await page.locator('#mode').count(),0);
    assert(await page.locator('#pulseras').isVisible());
    await page.locator('#toExercise').click();
    await click('presentRoute');
    assert(await page.locator('.settings').isHidden());
    assert.equal(await page.locator('#presentRoute').getAttribute('aria-pressed'),'true');
    await page.locator('#connectNeeded').click();
    await page.locator('#pulseras').waitFor({state:'visible'});
    assert(await page.locator('#start').isDisabled());
    await page.evaluate(() => start());
    assert.equal(await page.locator('#history option').count(),0);
    await click('connectL');
    assert(await page.locator('#start').isDisabled());
    await click('testL');
    await page.clock.runFor(2000);
    assert(await page.locator('#start').isDisabled());
    await click('confirmL');
    assert(await page.locator('#start').isEnabled());
    await select('kind','trial');
    assert(await page.locator('#start').isDisabled());
    await pair('R');
    await select('kind','route');
    for (const [trip, profile, expected] of [
      ['lastarria','bici',9],['lastarria','moto',7],['yungay','bici',6],
      ['yungay','moto',2],['nunoa','bici',8],['nunoa','moto',5]
    ]) {
      await select('trip',trip);
      await select('profile',profile);
      const rider = () => page.locator('#mapRider').getAttribute('transform');
      assert.equal(await text('turnCount'), String(expected));
      const origin = await rider();
      await click('start');
      await page.clock.runFor(1200);
      await click('pause');
      const paused = await records();
      const stopped = await rider();
      assert.notEqual(stopped, origin);
      await page.clock.runFor(2000);
      assert.equal(await rider(), stopped);
      assert.deepEqual((await records()).events,paused.events);
      await click('start');
      await page.clock.runFor(70000);
      const s = await records();
      assert.equal(s.state,'Completada');
      assert.equal(await page.locator('#routeProgress').evaluate(p => p.value), 100);
      assert.equal(await text('turnText'), 'Destino alcanzado');
      assert.equal(s.mode,'ble');
      assert.equal(s.events.filter(e => e.result === 'Enviada').length,expected);
    }
    assert.equal(await page.locator('#history option').count(),6);
    await page.reload();
    assert.equal(await page.locator('#history option').count(),6);
    console.log('Seis rutas offline, 37 giros, pausa, reanudación y persistencia.');
    await select('trip','nunoa');
    await select('profile','moto');
    assert(await page.locator('#start').isDisabled());
    await pair('L');await pair('R');
    await click('start');
    await page.evaluate(() => {window.failSide='R';});
    await page.clock.runFor(65000);
    let s = await records();
    assert.equal(s.state,'En pausa');
    assert.equal(s.events.filter(e=>e.result==='Fallida').length,1);
    assert.equal(s.events.filter(e=>e.result==='Enviada').length,(await page.evaluate(()=>window.writes.length))-2);
    await page.evaluate(() => {window.failSide='';window.dropBand('R');});
    assert(await page.locator('#start').isDisabled());
    await pair('R');
    await click('start');
    await page.evaluate(() => window.dropBand('L'));
    assert.equal((await records()).state,'En pausa');
    await pair('L');await click('start');
    await page.clock.runFor(70000);
    s=await records();
    assert.equal(s.events.filter(e=>e.type==='signal').length,5);
    assert.equal(s.events.filter(e=>e.result==='Enviada').length,4);
    console.log('BLE simulado: una orden fallida, desconexión, reconexión, cuatro órdenes aceptadas.');
    await select('kind','trial');
    await click('start');
    for (let i=0;i<10;i++) {
      await page.clock.runFor(2000);
      await click('signal');
      assert(await page.locator('#records').isHidden());
      assert(await page.locator('#historyNav').isHidden());
      assert(await page.locator('#bandFeedback').isHidden());
      const side=await page.evaluate(()=>window.writes.at(-1));
      await page.locator('[data-answer="'+(i===9?'none':side)+'"]').click();
    }
    assert((await text('counts')).includes('9 aciertos de 10 respuestas'));
    assert.equal((await records()).state,'Completada');
    await select('kind','route');await click('start');await click('finish');
    assert.equal((await records()).state,'Finalizada');
    await click('start');
    await page.evaluate(() => {window.hangWrites=true;});
    await page.clock.runFor(65000);
    s=await records();
    assert.equal(s.state,'En pausa');
    assert.equal(s.events.filter(e=>e.result==='Sin confirmar').length,1);
    assert.equal(s.events.filter(e=>e.result==='Enviada').length,0);
    await page.reload();
    assert.equal(await page.locator('#history option').count(),10);
    assert((await text('summary')).includes('sin cierre'));
    await select('kind','route');
    await select('trip','nunoa');await select('profile','moto');
    await pair('L');
    await page.evaluate(() => {window.writes.length=0;});
    await click('start');
    assert((await text('message')).includes('una sola pulsera'));
    await page.clock.runFor(70000);
    s=await records();
    assert.equal(s.state,'Completada');
    assert.deepEqual(s.sides,['L']);
    const sent=s.events.filter(e=>e.result==='Enviada').length, absent=s.events.filter(e=>e.result==='Sin pulsera').length;
    assert.equal(sent+absent,5);
    assert(sent>0 && absent>0);
    assert(await page.evaluate(()=>window.writes.every(w=>w==='L')));
    assert.equal(await page.evaluate(()=>window.writes.length),sent);
    assert((await text('counts')).includes(absent+' sin pulsera'));
    await page.reload();
    console.log('Ruta con una sola pulsera: giros del otro lado anotados sin vibrar.');
    assert.deepEqual(errors,[]);
    console.log('Diez ensayos de tacto con respuestas simuladas, cierre manual, escritura sin respuesta y diez registros recuperados.');
    await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href + '?vista=maqueta');
    await page.getByRole('link',{name:'Control manual de pulseras'}).click();
    assert.equal(await page.locator('#kind').inputValue(),'manual');
    assert.equal(await page.locator('#mode').count(),0);
    assert(await page.locator('#routeOptions').isHidden());
    assert(await page.locator('#manualL').isDisabled());
    await pair('L');
    assert(await page.locator('#manualR').isDisabled());
    await click('manualL');
    assert(await page.locator('#manualL').isDisabled());
    await pair('R');
    await page.evaluate(() => {window.writes.length=0;});
    await click('manualR');await click('manualL');
    await page.clock.runFor(10000);
    assert.deepEqual(await page.evaluate(()=>window.writes),['R','L']);
    await page.evaluate(() => window.dropBand('R'));
    assert.equal((await records()).state,'En pausa');
    assert(await page.locator('#manualL').isDisabled());
    await click('start');
    assert(await page.locator('#manualR').isDisabled());
    await page.evaluate(() => {window.failSide='L';});
    await click('manualL');
    assert.equal((await records()).events.filter(e=>e.result==='Fallida').length,1);
    await click('finish');
    await page.evaluate(() => {window.failSide='';});
    await click('testL');await page.clock.runFor(2000);await click('confirmL');
    await pair('R');
    await click('manualR');await click('pause');await click('start');await click('manualL');await click('finish');
    const manual=await records();
    assert.equal(manual.kind,'manual');
    assert.deepEqual(manual.events.filter(e=>e.result==='Enviada').map(e=>e.side),['R','L']);
    await page.reload();
    await openScreen('historial');
    assert(await page.locator('#records').isVisible());
    assert((await page.locator('#history option').first().innerText()).includes('Control manual'));
    assert.deepEqual(errors,[]);
    await openScreen('pulseras');
    assert.equal(await page.locator('#setup').inputValue(),'two');
    await pair('L');
    await page.locator('#setup').selectOption('single');
    assert(await page.locator('#bandsTwo').isHidden());
    assert((await text('linkSummary')).includes('Sin conexión'));
    assert(await page.evaluate(() => !links.L));
    await page.reload();
    assert.equal(await page.locator('#setup').inputValue(),'single');
    await page.evaluate(() => {window.writes.length=0;});
    await click('connectS');
    assert(await page.locator('#start').isDisabled());
    await click('testS');
    await page.clock.runFor(1500);
    assert.deepEqual(await page.evaluate(() => window.writes),['L']);
    await page.clock.runFor(3700);
    assert.deepEqual(await page.evaluate(() => window.writes),['L','R']);
    await click('confirmS');
    for (const [trip, profile, expected] of [['nunoa','moto','RRLRL'],['lastarria','bici','RRLRLRLLR']]) {
      await select('kind','route');await select('trip',trip);await select('profile',profile);
      await page.evaluate(() => {window.writes.length=0;});
      await click('start');
      assert(!(await page.locator('#message').innerText()).includes('una sola pulsera'));
      assert(await page.evaluate(() => el('setup').disabled));
      await page.clock.runFor(180000);
      s=await records();
      assert.equal(s.state,'Completada');
      assert.equal(s.setup,'single');
      assert.equal((await page.evaluate(() => window.writes)).join(''),expected);
      const times=s.events.filter(e=>e.type==='signal').map(e=>e.time);
      assert(times.every((t,i) => !i || t-times[i-1]>=2900));
      assert(s.events.filter(e=>e.type==='signal').every(e=>e.result==='Enviada'));
    }
    await select('kind','route');
    await click('start');await page.clock.runFor(1500);
    await page.evaluate(() => window.dropBand('1'));
    assert.equal((await records()).state,'En pausa');
    await click('connectS');await click('testS');await page.clock.runFor(5200);await click('confirmS');
    await click('start');
    assert.equal((await records()).state,'En curso');
    await click('finish');
    await select('kind','manual');
    await page.evaluate(() => {window.writes.length=0;});
    await click('manualR');
    assert(await page.locator('#manualL').isDisabled());
    await page.clock.runFor(3100);
    await click('manualL');
    assert.deepEqual(await page.evaluate(() => window.writes),['R','L']);
    await click('finish');
    await select('kind','trial');
    await page.clock.runFor(3100);
    await click('start');
    for (let i=0;i<10;i++) {
      await click('signal');
      const side=await page.evaluate(()=>window.writes.at(-1));
      await page.locator('[data-answer="'+side+'"]').click();
      await page.clock.runFor(3100);
    }
    assert((await text('counts')).includes('10 aciertos de 10 respuestas'));
    await openScreen('historial');
    assert((await page.locator('#history option').first().innerText()).includes('una pulsera'));
    await openScreen('pulseras');
    await page.locator('#setup').selectOption('two');
    assert(await page.locator('#bandsOne').isHidden());
    assert.deepEqual(errors,[]);
    console.log('Configuración de una pulsera: 1 y 2 vibraciones en prueba, ruta, manual y tacto; la de dos pulseras sigue igual.');
    console.log('Control manual con una y dos pulseras, bloqueo de doble pulso, pausa por desconexión y registro Bluetooth.');
  } finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
