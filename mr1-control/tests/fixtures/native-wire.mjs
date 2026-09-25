import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { REALTIME } from '../../service/native-controller.mjs';
import { createSimulatedPreflightTranscript } from '../../service/controller-preflight.mjs';

export const profile = JSON.parse(readFileSync(new URL('../../../grblHAL-STM32F4/mr1/expected-settings.json', import.meta.url)));
export const sampleProgram = 'G90 G94\nG17\nG21\nG40 G49 G80\nG53 G0 Z-2\nT1\nM0\nS5000 M3\nG54\nG0 X0 Y0\nG0 Z5\nG1 Z0 F100\nM5\nM9\nG53 G0 Z-2\nM30';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Byte-level test double. Never exposed by the production serial factory.
export class WireController extends EventEmitter {
  constructor() { super(); this.path = 'COM7'; this.isOpen = false; this.writes = []; this.state = 'Idle'; this.homed = true; this.position = [-100, -100, -20]; this.ignore = null; this.pins = ''; this.silent = false; this.sensor = 0; this.probeHits = []; }
  // Like the USB CDC firmware, print the welcome banner after the DTR edge of every open.
  open(cb) {
    this.isOpen = true; cb();
    if (this.welcomeDelay !== false) this.welcomeTimer = setTimeout(() => { if (this.isOpen) this.send("GrblHAL 1.1f ['$' or '$HELP' for help]\r\n"); }, this.welcomeDelay ?? 0);
  }
  close(cb) { clearTimeout(this.welcomeTimer); this.isOpen = false; this.emit('close'); cb(); }
  status(full = false) { return `<${this.state}|MPos:${this.position.join(',')}|WCO:0,0,0|FS:0,0${this.omitPeriodicFields && !full ? '' : `|H:${this.homed ? 1 : 0},${this.homedMask ?? (this.homed ? 7 : 0)}|A:|P:${this.sensor}`}|Pn:${this.pins}>\r\n`; }
  send(text) { this.emit('data', Buffer.from(text)); }
  write(data, cb) {
    const bytes = Buffer.isBuffer(data) ? [...data] : String(data).trim(); this.writes.push(bytes); cb?.();
    queueMicrotask(() => {
      if (Array.isArray(bytes)) {
        if (bytes[0] === REALTIME.status && !this.silent && !this.awaitingHomeReport) this.send(this.status());
        if (bytes[0] === REALTIME.statusAll && !this.silent && !this.awaitingHomeReport) this.send(this.status(true).replace('>', '|FW:grblHAL>'));
        if (bytes[0] === REALTIME.hold) { this.state = 'Hold:0'; this.send(this.status()); }
        if (bytes[0] === REALTIME.resume) {
          this.state = 'Idle'; this.send(this.status());
          if (this.pauseAckPending) { this.pauseAckPending = false; this.send('ok\r\n'); }
        }
        return;
      }
      if (bytes === this.ignore) return;
      if (bytes === '$I+') this.send(`[BOARD:${profile.boardIdentityContains}]\r\n[OPT:VN${(this.settingOverrides?.[22] ?? 7) & 4 ? '' : 'L'},35,1024]\r\n`);
      if (bytes === '$$') this.send(createSimulatedPreflightTranscript(profile, this.status(), this.settingOverrides ?? {}).split('\r\n').filter(s => s.startsWith('$')).join('\r\n') + `\r\n$13=${this.settingOverrides?.[13] ?? 0}\r\n`);
      if (/^\$22=(3|7)$/.test(bytes)) this.settingOverrides = { ...this.settingOverrides, 22: Number(bytes.slice(4)) };
      if (bytes === '$X') {
        if ((this.settingOverrides?.[22] ?? 7) & 4) { this.send('error:9\r\n'); return; }
        this.state = 'Idle';
      }
      if (bytes === '$G') this.send('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T1 F100 S0]\r\n');
      if (bytes === '$N') this.send(`$N0=${this.startupBlock ?? ''}\r\n$N1=\r\n`);
      if (/^G65 P5 Q[01]$/.test(bytes)) this.sensor = Number(bytes.at(-1));
      if (bytes.startsWith('G21 G91 G94')) {
        const [, letter, value] = bytes.match(/ ([XYZ])([-\d.]+)/);
        const index = ['X', 'Y', 'Z'].indexOf(letter);
        if (bytes.includes('G38.2')) {
          const hit = this.probeHits.shift();
          if (hit) {
            this.position = hit.position; this.pins = hit.success ? 'P' : '';
            this.send(`[PRB:${this.position.join(',')}:${hit.success ? 1 : 0}]\r\n`);
          }
        } else { this.position[index] += Number(value); this.pins = ''; }
      }
      if (/^\$H[XYZ]?$/.test(bytes)) {
        // grblHAL returns to Alarm/HomingRequired after a successful partial
        // home while the remaining axes are still unreferenced. The ok alone
        // is not the final status report, even when both arrive in one chunk.
        this.state = 'Home'; this.send(this.status());
        const mask = bytes === '$H' ? 7 : { X: 1, Y: 2, Z: 4 }[bytes.at(-1)];
        this.homedMask = (this.homedMask ?? (this.homed ? 7 : 0)) | mask;
        this.homed = this.homedMask === 7;
        this.send('o'); this.send('k\r\n');
        this.state = this.homed ? 'Idle' : 'Alarm:22';
        this.awaitingHomeReport = this.deferHomeReport === true;
        if (!this.awaitingHomeReport) this.send(this.status());
        return;
      }
      if (/M0+(?:[^0-9.]|$)/i.test(bytes)) {
        this.state = 'Hold:0'; this.send(this.status());
        if (this.deferPauseAck) { this.pauseAckPending = true; return; }
      }
      this.send('o'); this.send('k\r\n');
    });
  }
}
