(function(){
  'use strict';
  const NS = window.RayStarfall = window.RayStarfall || {};

  function AudioEngine(){
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.ambient = null;
    this.lastSfx = new Map();
  }

  AudioEngine.prototype.init = function(){
    if (this.ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
  };

  AudioEngine.prototype.resume = function(){
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  AudioEngine.prototype.setEnabled = function(value){
    this.enabled = !!value;
    if (!this.enabled) this.stopAmbient();
  };

  AudioEngine.prototype.tone = function(freq, duration, type, volume, slide){
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume || 0.08), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  };

  AudioEngine.prototype.noise = function(duration, volume, filterFreq){
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<len;i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 900;
    gain.gain.setValueAtTime(volume || 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.03);
  };

  AudioEngine.prototype.sfx = function(name){
    if (!this.enabled) return;
    const t = performance.now();
    const last = this.lastSfx.get(name) || 0;
    if (t - last < 28) return;
    this.lastSfx.set(name, t);
    switch(name){
      case 'tap': this.tone(600,.055,'triangle',.045,120); break;
      case 'shoot': this.tone(760,.045,'square',.025,220); break;
      case 'hit': this.tone(210,.065,'sawtooth',.042,-70); break;
      case 'pickup': this.tone(980,.08,'sine',.055,360); setTimeout(()=>this.tone(1420,.07,'sine',.045,180),45); break;
      case 'coin': this.tone(1160,.08,'triangle',.06,560); break;
      case 'damage': this.noise(.14,.12,700); this.tone(130,.13,'sawtooth',.08,-45); break;
      case 'dash': this.noise(.09,.07,1600); this.tone(420,.08,'triangle',.06,420); break;
      case 'aegis': this.tone(350,.10,'sine',.065,520); this.tone(700,.16,'sine',.035,180); break;
      case 'nova': this.noise(.26,.17,1400); this.tone(90,.28,'sawtooth',.08,280); break;
      case 'upgrade': this.tone(520,.08,'sine',.055,320); setTimeout(()=>this.tone(760,.08,'triangle',.05,380),70); setTimeout(()=>this.tone(1120,.12,'sine',.05,420),140); break;
      case 'boss': this.tone(95,.24,'sawtooth',.085,-20); setTimeout(()=>this.tone(150,.22,'sawtooth',.06,40),90); break;
      case 'gameover': this.tone(260,.18,'triangle',.07,-80); setTimeout(()=>this.tone(170,.22,'triangle',.06,-50),150); break;
      default: this.tone(440,.08,'sine',.04,0);
    }
  };

  AudioEngine.prototype.startAmbient = function(){
    if (!this.enabled || this.ambient || !window.AudioContext && !window.webkitAudioContext) return;
    this.resume();
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.026, now + 1.2);
    gain.connect(this.master);
    const oscs = [55,82.41,110].map((freq, idx)=>{
      const osc = this.ctx.createOscillator();
      osc.type = idx === 1 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      osc.detune.value = idx * 4 - 4;
      osc.connect(gain);
      osc.start();
      return osc;
    });
    this.ambient = { gain, oscs };
  };

  AudioEngine.prototype.stopAmbient = function(){
    if (!this.ambient || !this.ctx) return;
    const now = this.ctx.currentTime;
    try { this.ambient.gain.gain.exponentialRampToValueAtTime(0.0001, now + .45); } catch(e){}
    const amb = this.ambient;
    setTimeout(()=>{
      amb.oscs.forEach(o=>{ try{o.stop();}catch(e){} });
      try{amb.gain.disconnect();}catch(e){}
    },520);
    this.ambient = null;
  };

  function vibrate(pattern){
    const settings = NS.Store && NS.Store.getSettings ? NS.Store.getSettings() : { vibrate:true };
    if (!settings.vibrate || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch(e){}
  }

  NS.AudioEngine = AudioEngine;
  NS.vibrate = vibrate;
})();
