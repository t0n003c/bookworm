/* ─────────────────────────────────────────────────────────────────────────
   timeline-bg.js — a subtle animated aurora behind the Timeline view.

   window.bwTimelineBg(container, isDark) → cleanup()

   A single full-screen GLSL fragment shader (domain-warped fbm) drifting
   slowly behind the spine + cards. Deliberately gentle so it never competes
   with the content. Performance-guarded:
     • renders at ~0.55× resolution, capped to ~30 fps
     • pauses when the tab is hidden
     • prefers-reduced-motion → one static frame, no loop
     • no WebGL / shader-link failure → clean CSS-gradient fallback
     • re-themes live on dark-mode toggle; full teardown on unmount
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var FRAG = [
    'precision mediump float;',
    'uniform float u_time; uniform vec2 u_res; uniform float u_dark;',
    'uniform vec3 u_base; uniform vec3 u_a; uniform vec3 u_b;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p);',
    '  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));',
    '  vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }',
    'float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=.5; } return v; }',
    'void main(){',
    '  vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;',
    '  float t=u_time*0.025;',
    '  float w=fbm(p*1.4+vec2(t,-t*0.6));',
    '  float n=fbm(p*2.0+w*0.9+vec2(-t*0.5,t*0.4));',
    '  float band=smoothstep(0.34,0.66,n);',
    '  float inten=mix(0.10,0.52,u_dark);',
    '  vec3 col=u_base;',
    '  col=mix(col,u_a,band*inten);',
    '  col=mix(col,u_b,smoothstep(0.5,0.86,n)*inten*0.7);',
    '  float glow=smoothstep(0.95,0.0,length(p))*mix(0.03,0.15,u_dark);',
    '  col+=u_a*glow;',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  function bwTimelineBg(container, isDark) {
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;' +
      'pointer-events:none;z-index:0;';
    container.insertBefore(canvas, container.firstChild);

    function gradientFallback() {
      canvas.style.background = isDark
        ? 'radial-gradient(130% 90% at 50% 45%, #141a36 0%, #09090b 72%)'
        : 'radial-gradient(130% 90% at 50% 45%, #eef2ff 0%, #f9fafb 72%)';
      return function () { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); };
    }

    var gl;
    try {
      gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false,
                                        powerPreference: 'low-power' })
        || canvas.getContext('experimental-webgl');
    } catch (e) { gl = null; }
    if (!gl) return gradientFallback();

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return gradientFallback();
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, 'u_time'),
        uRes  = gl.getUniformLocation(prog, 'u_res'),
        uDark = gl.getUniformLocation(prog, 'u_dark'),
        uBase = gl.getUniformLocation(prog, 'u_base'),
        uA    = gl.getUniformLocation(prog, 'u_a'),
        uB    = gl.getUniformLocation(prog, 'u_b');

    function setTheme(dark) {
      gl.uniform1f(uDark, dark ? 1.0 : 0.0);
      if (dark) {
        gl.uniform3f(uBase, 0.035, 0.035, 0.043);  // near-black
        gl.uniform3f(uA, 0.00, 0.32, 0.89);        // brand blue
        gl.uniform3f(uB, 0.49, 0.23, 0.93);        // violet
      } else {
        gl.uniform3f(uBase, 0.976, 0.980, 0.984);  // near-white
        gl.uniform3f(uA, 0.78, 0.86, 1.00);        // pale blue
        gl.uniform3f(uB, 0.90, 0.85, 1.00);        // pale lavender
      }
    }
    setTheme(isDark);

    var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    var SCALE = 0.55;  // render below native res — it's a soft gradient
    function resize() {
      var w = Math.max(1, Math.round(container.clientWidth  * DPR * SCALE));
      var h = Math.max(1, Math.round(container.clientHeight * DPR * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    }
    resize();

    var raf = 0, start = null, last = 0, alive = true;
    function frame(ts) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (start === null) start = ts;
      if (ts - last < 33) return;   // ~30 fps cap
      last = ts;
      resize();
      gl.uniform1f(uTime, (ts - start) / 1000.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var reduce = window.matchMedia &&
                 window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      gl.uniform1f(uTime, 12.0); gl.drawArrays(gl.TRIANGLES, 0, 3);  // one static frame
    } else {
      raf = requestAnimationFrame(frame);
    }

    var onResize = function () { resize(); };
    window.addEventListener('resize', onResize);
    var mo = new MutationObserver(function () {
      setTheme(document.documentElement.classList.contains('dark'));
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return function cleanup() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      mo.disconnect();
      try {
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      } catch (e) {}
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }

  window.bwTimelineBg = bwTimelineBg;
})();
