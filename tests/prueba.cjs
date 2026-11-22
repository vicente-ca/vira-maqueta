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
      const device = new EventTarget();
      device.id = name;
      const characteristic = {
        properties:{write:true},
        async writeValueWithResponse(bytes) {
          const command = new TextDecoder().decode(bytes);
          if (command !== side || !device.gatt.connected || window.failSide === side) throw Error('Write failed');
          if (window.hangWrites) return new Promise(() => {});
          window.writes.push(side);
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
    await page.getByRole('link',{name:'Abrir prueba de ruta'}).click();
    await page.clock.install();
    const click = id => page.locator('#'+id).click();
    const text = id => page.locator('#'+id).innerText();
    const select = (id,value) => page.locator('#'+id).selectOption(value);
    const records = () => page.evaluate(() => JSON.parse(localStorage.getItem('vira.prueba.v1.' + document.getElementById('history').value)));
    for (const [trip, profile, expected] of [
      ['lastarria','bici',9],['lastarria','moto',7],['yungay','bici',6],
      ['yungay','moto',2],['nunoa','bici',8],['nunoa','moto',5]
    ]) {
      await select('trip',trip);
      await select('profile',profile);
      await click('start');
      await click('pause');
      const paused = await records();
      await page.clock.runFor(2000);
      assert.deepEqual((await records()).events,paused.events);
      await click('start');
      await page.clock.runFor(70000);
      const s = await records();
      assert.equal(s.state,'Completada');
      assert.equal(s.events.filter(e => e.result === 'Simulada').length,expected);
    }
    assert.equal(await page.locator('#history option').count(),6);
    await page.reload();
    assert.equal(await page.locator('#history option').count(),6);
    console.log('Seis rutas offline, 37 giros, pausa, reanudación y persistencia.');
    await select('trip','nunoa');
    await select('profile','moto');
    await select('mode','ble');
    assert(await page.locator('#start').isDisabled());
    async function pair(side) {
      await click('connect'+side);
      await click('test'+side);
      await page.clock.runFor(2000);
      await click('confirm'+side);
    }
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
    await select('mode','ble');await select('kind','route');
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
    await page.getByRole('link',{name:'Ver maqueta'}).click();
    await page.getByRole('link',{name:'Control manual de pulseras'}).click();
    assert.equal(await page.locator('#kind').inputValue(),'manual');
    assert.equal(await page.locator('#mode').inputValue(),'ble');
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
    await select('mode','sim');
    await click('manualR');await click('pause');await click('start');await click('manualL');await click('finish');
    const manual=await records();
    assert.equal(manual.kind,'manual');
    assert.deepEqual(manual.events.filter(e=>e.result==='Simulada').map(e=>e.side),['R','L']);
    await page.reload();
    assert((await page.locator('#history option').first().innerText()).includes('Control manual'));
    assert.deepEqual(errors,[]);
    console.log('Botones manuales: acceso móvil, una y dos pulseras, orden por lado, bloqueo de doble pulso, pausa por desconexión, fallo y simulación guardados.');
  } finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
