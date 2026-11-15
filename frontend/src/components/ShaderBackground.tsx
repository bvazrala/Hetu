import { useEffect, useRef } from 'react'

// A slow, low-contrast field of paper and green, drawn with WebGL. It takes
// its colors from the theme tokens and follows theme changes. It draws one
// still frame when the device asks for reduced motion, pauses in a hidden
// tab, and falls back to a plain gradient where WebGL is missing.

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const FRAGMENT = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform vec3 paper;
uniform vec3 soft;
uniform vec3 leaf;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0, amplitude = 0.5;
  for (int i = 0; i < 5; i++) { value += amplitude * noise(p); p *= 2.03; amplitude *= 0.5; }
  return value;
}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = uv * vec2(resolution.x / resolution.y, 1.0) * 1.8;
  float t = time * 0.03;
  vec2 q = vec2(fbm(p + vec2(t, -t)), fbm(p + vec2(5.2, 1.3) - t));
  float n = fbm(p + 1.8 * q + vec2(0.0, t));
  vec3 color = mix(paper, soft, smoothstep(0.30, 0.70, n));
  color = mix(color, leaf, smoothstep(0.58, 0.92, n) * 0.45);
  color += (hash(gl_FragCoord.xy) - 0.5) * 0.02;
  gl_FragColor = vec4(color, 1.0);
}
`

function tokenColor(name: string): [number, number, number] {
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  document.body.append(probe)
  const match = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']
  probe.remove()
  return [Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255]
}

export function ShaderBackground({ className = '' }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const fallback = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = canvas.current
    const gl = element?.getContext('webgl', { antialias: false, premultipliedAlpha: false })
    if (!element || !gl) {
      if (fallback.current) fallback.current.hidden = false
      return
    }

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (fallback.current) fallback.current.hidden = false
      return
    }
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const uniform = (name: string) => gl.getUniformLocation(program, name)

    const applyTheme = () => {
      gl.uniform3fv(uniform('paper'), tokenColor('--color-paper'))
      gl.uniform3fv(uniform('soft'), tokenColor('--color-accent-soft'))
      gl.uniform3fv(uniform('leaf'), tokenColor('--color-logo-bar'))
    }
    const resize = () => {
      // Kept at a modest resolution: the field is soft, so sharpness is wasted work.
      const scale = Math.min(window.devicePixelRatio || 1, 1.25)
      element.width = Math.max(1, Math.round(element.clientWidth * scale))
      element.height = Math.max(1, Math.round(element.clientHeight * scale))
      gl.viewport(0, 0, element.width, element.height)
      gl.uniform2f(uniform('resolution'), element.width, element.height)
    }
    const draw = (seconds: number) => {
      gl.uniform1f(uniform('time'), seconds)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    applyTheme()
    resize()
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let frame = 0
    let last = 0
    const start = performance.now()
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      if (document.hidden || now - last < 33) return
      last = now
      draw(20 + (now - start) / 1000)
    }
    if (still) draw(20)
    else frame = requestAnimationFrame(loop)

    const resizeObserver = new ResizeObserver(() => {
      resize()
      if (still) draw(20)
    })
    resizeObserver.observe(element)
    const themeObserver = new MutationObserver(() => {
      applyTheme()
      if (still) draw(20)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      // The context belongs to the canvas and is reused if this effect runs again,
      // as React does in development, so only what was created here is freed.
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [])

  return (
    <div aria-hidden="true" className={'pointer-events-none absolute inset-0 ' + className}>
      <canvas ref={canvas} className="h-full w-full" />
      <div
        ref={fallback}
        hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,var(--color-accent-soft),transparent_60%),radial-gradient(circle_at_80%_90%,var(--color-flag-soft),transparent_55%)]"
      />
    </div>
  )
}
