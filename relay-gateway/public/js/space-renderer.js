import * as THREE from '/js/three.module.js';
import { EffectComposer } from '/js/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/js/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/js/addons/postprocessing/UnrealBloomPass.js';

export 
    // ========================================================================
    // GOLDEN RATIO CONSTANTS
    // ========================================================================
    const PHI = 1.618033988749894;
    const PHI_CUBED = PHI * PHI * PHI;
    const BURN_RATE = 1 - (1 / PHI_CUBED);
    const TREASURY_RATE = 1 / PHI_CUBED;
    const ECOSYSTEM_BONUS = 1 / (PHI * PHI);

    // ========================================================================
    // SPACE RENDERER - Full version with all effects
    // Stars, Milky Way, Nebulae, Cosmic Dust, Lorenz Comets
    // ========================================================================
    class SpaceRenderer {
      constructor(container) {
        this.container = container;
        this.time = 0;
        this.scrollY = 0;
        this.targetScrollY = 0;
        this.scrollProgress = 0;

        // Mobile detection - reduce particles by 50%
        this.isMobile = window.innerWidth < 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.particleMultiplier = this.isMobile ? 0.5 : 1.0;

        // Mouse parallax - wider movement
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetMouseX = 0;
        this.targetMouseY = 0;

        this.init();
        this.createStars();
        this.createMilkyWay();
        this.createNebulae();
        this.createCosmicDust();
        this.createComets();
        this.setupPostProcessing();
        this.animate();
        this.setupEventListeners();
      }

      init() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        this.camera.position.z = 5;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 1);
        this.container.appendChild(this.renderer.domElement);
      }

      // Stars with Harvard spectral classification
      createStars() {
        const spectralColors = [
          new THREE.Color(0x9bb0ff), new THREE.Color(0xaabfff), new THREE.Color(0xcad7ff),
          new THREE.Color(0xf8f7ff), new THREE.Color(0xfff4e8), new THREE.Color(0xffd2a1), new THREE.Color(0xffbb7b)
        ];
        const spectralProbs = [0.00003, 0.0013, 0.006, 0.03, 0.076, 0.121, 0.765];

        // Mobile: 50% particles for performance
        const starCount = Math.floor(12000 * this.particleMultiplier);
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const brightness = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
          const i3 = i * 3;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const radius = 400 + Math.random() * 1200;

          const galacticConcentration = Math.exp(-Math.abs(phi - Math.PI/2) * 2);
          const r = radius * (0.5 + 0.5 * galacticConcentration);

          positions[i3] = r * Math.sin(phi) * Math.cos(theta);
          positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
          positions[i3 + 2] = r * Math.cos(phi);

          let rand = Math.random(), cumulative = 0, spectralIndex = 6;
          for (let j = 0; j < spectralProbs.length; j++) {
            cumulative += spectralProbs[j];
            if (rand < cumulative) { spectralIndex = j; break; }
          }

          const color = spectralColors[spectralIndex];
          colors[i3] = color.r;
          colors[i3 + 1] = color.g;
          colors[i3 + 2] = color.b;

          const magRand = Math.random();
          let magnitude = magRand < 0.002 ? Math.random() : magRand < 0.02 ? 1 + Math.random() : magRand < 0.1 ? 2 + Math.random() : magRand < 0.3 ? 3 + Math.random() : 4 + Math.random() * 2;
          sizes[i] = magnitude < 1 ? 3.0 : magnitude < 2 ? 2.0 : magnitude < 3 ? 1.3 : 0.7;
          brightness[i] = Math.pow(2.512, (5 - magnitude) / 2.5);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('brightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
          uniforms: { time: { value: 0 }, pixelRatio: { value: this.renderer.getPixelRatio() } },
          vertexShader: `
            attribute float size;
            attribute float brightness;
            varying vec3 vColor;
            varying float vBrightness;
            uniform float time;
            uniform float pixelRatio;
            void main() {
              vColor = color;
              vBrightness = brightness;
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              float sizeVar = 1.0 + sin(time * 0.2 + position.x * 0.01) * 0.08;
              gl_PointSize = size * sizeVar * pixelRatio * (550.0 / -mvPosition.z);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            varying vec3 vColor;
            varying float vBrightness;
            void main() {
              vec2 uv = gl_PointCoord - 0.5;
              float dist = length(uv);
              float core = exp(-dist * 5.0);
              float glow = exp(-dist * 2.0) * 0.25;
              float alpha = (core + glow) * vBrightness;
              gl_FragColor = vec4(vColor, clamp(alpha, 0.0, 1.0));
            }
          `,
          transparent: true,
          vertexColors: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });

        this.stars = new THREE.Points(geometry, material);
        this.scene.add(this.stars);
      }

      // Milky Way particle cloud - INTENSIFIED
      createMilkyWay() {
        // Mobile: 50% particles for performance
        const particleCount = Math.floor(10000 * this.particleMultiplier);
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const alphas = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
          const i3 = i * 3;
          const x = (Math.random() - 0.5) * 3000;
          const ySpread = 80 + Math.random() * 120;
          const y = (Math.random() - 0.5) * ySpread * (0.3 + Math.random() * 0.7);
          const z = -400 - Math.random() * 800;

          positions[i3] = x;
          positions[i3 + 1] = y;
          positions[i3 + 2] = z;

          // Warmer, more vivid colors
          const warmth = 0.88 + Math.random() * 0.12;
          colors[i3] = warmth;
          colors[i3 + 1] = warmth * 0.93;
          colors[i3 + 2] = warmth * 0.75;

          sizes[i] = 1.5 + Math.random() * 3.0;
          const distFromCenter = Math.abs(y) / 100;
          // Intensified alpha: 2.5x brighter
          alphas[i] = (1 - distFromCenter) * (0.035 + Math.random() * 0.045);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

        const material = new THREE.ShaderMaterial({
          uniforms: { time: { value: 0 } },
          vertexShader: `
            attribute float size;
            attribute float alpha;
            varying vec3 vColor;
            varying float vAlpha;
            uniform float time;
            void main() {
              vColor = color;
              vAlpha = alpha;
              vec3 pos = position;
              pos.x += sin(time * 0.08 + position.z * 0.008) * 1.5;
              pos.y += cos(time * 0.06 + position.x * 0.008) * 0.8;
              vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
              gl_PointSize = size * (350.0 / -mvPosition.z);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
              vec2 center = gl_PointCoord - 0.5;
              float dist = length(center);
              float alpha = smoothstep(0.5, 0.0, dist) * vAlpha;
              gl_FragColor = vec4(vColor, alpha);
            }
          `,
          transparent: true,
          vertexColors: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });

        this.milkyWay = new THREE.Points(geometry, material);
        this.milkyWay.rotation.z = -12 * Math.PI / 180;
        this.scene.add(this.milkyWay);
      }

      // Nebulae with FBM noise
      createNebulae() {
        this.nebulae = [];
        const configs = [
          { x: -350, y: 180, z: -550, size: 280, color: new THREE.Color(0x4466aa), opacity: 0.035 },
          { x: 450, y: -130, z: -650, size: 230, color: new THREE.Color(0x884488), opacity: 0.03 },
          { x: -180, y: -280, z: -450, size: 180, color: new THREE.Color(0xaa4455), opacity: 0.025 },
          { x: 280, y: 350, z: -800, size: 320, color: new THREE.Color(0x446688), opacity: 0.02 },
        ];

        const geometry = new THREE.PlaneGeometry(1, 1);

        configs.forEach(cfg => {
          const material = new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 }, baseColor: { value: cfg.color }, opacity: { value: cfg.opacity } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform float time;
              uniform vec3 baseColor;
              uniform float opacity;
              varying vec2 vUv;
              float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
              float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
              }
              float fbm(vec2 p) {
                float v = 0.0, a = 0.5;
                for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
                return v;
              }
              void main() {
                vec2 uv = vUv - 0.5;
                float dist = length(uv);
                float falloff = pow(1.0 - smoothstep(0.0, 0.5, dist), 1.5);
                float structure = fbm(uv * 3.0 + time * 0.015) * 0.5 + fbm(uv * 6.0 - time * 0.01) * 0.3 + fbm(uv * 9.0 + time * 0.008) * 0.2;
                vec3 color = baseColor + vec3(structure * 0.15);
                gl_FragColor = vec4(color, falloff * structure * opacity);
              }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          });

          const nebula = new THREE.Mesh(geometry, material);
          nebula.scale.set(cfg.size, cfg.size, 1);
          nebula.position.set(cfg.x, cfg.y, cfg.z);
          nebula.userData.baseX = cfg.x;
          nebula.userData.baseY = cfg.y;
          nebula.userData.baseZ = cfg.z;
          this.nebulae.push(nebula);
          this.scene.add(nebula);
        });
      }

      // Cosmic dust particles
      createCosmicDust() {
        // Mobile: 50% particles for performance
        const dustCount = Math.floor(1500 * this.particleMultiplier);
        const positions = new Float32Array(dustCount * 3);
        const velocities = new Float32Array(dustCount * 3);

        for (let i = 0; i < dustCount; i++) {
          const i3 = i * 3;
          positions[i3] = (Math.random() - 0.5) * 180;
          positions[i3 + 1] = (Math.random() - 0.5) * 180;
          positions[i3 + 2] = (Math.random() - 0.5) * 180;
          velocities[i3] = (Math.random() - 0.5) * 0.015;
          velocities[i3 + 1] = (Math.random() - 0.5) * 0.015;
          velocities[i3 + 2] = (Math.random() - 0.5) * 0.015;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

        const material = new THREE.ShaderMaterial({
          uniforms: { time: { value: 0 }, scrollOffset: { value: 0 } },
          vertexShader: `
            attribute vec3 velocity;
            uniform float time;
            uniform float scrollOffset;
            varying float vAlpha;
            void main() {
              vec3 pos = position + velocity * time * 8.0;
              pos.y += scrollOffset * 0.03;
              pos = mod(pos + 90.0, 180.0) - 90.0;
              vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
              vAlpha = 0.25 * (1.0 - smoothstep(10.0, 90.0, -mvPosition.z));
              gl_PointSize = 1.2 * (40.0 / -mvPosition.z);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            varying float vAlpha;
            void main() {
              float dist = length(gl_PointCoord - 0.5);
              float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * vAlpha;
              gl_FragColor = vec4(0.85, 0.8, 0.75, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });

        this.cosmicDust = new THREE.Points(geometry, material);
        this.scene.add(this.cosmicDust);
      }

      // ========================================================================
      // GOLDEN RATIO COMETS - Mathematically perfect psychological harmony
      // Based on φ (1.618...), Fibonacci, Z-pattern reading, Rule of Thirds
      // ========================================================================
      createComets() {
        this.cometPool = [];

        // Golden ratio constants
        const PHI_INV = 1 / PHI;
        const PHI_SQ = PHI * PHI;
        const PHI_INV_SQ = 1 / PHI_SQ;

        // Rule of thirds intersections
        const THIRD = 1/3;
        const TWO_THIRD = 2/3;

        // Fibonacci timing sequence (seconds)
        const FIB = [1, 1, 2, 3, 5, 8, 13];

        this.cometConfig = {
          tailSegments: 65,
          lorenz: { sigma: 10, rho: 28, beta: 8/3 },
        };

        // Mathematically balanced paths using golden ratio
        this.strategicPaths = [
          { trigger: 0, startX: PHI_INV, startY: PHI_INV, targetX: 0, targetY: -PHI_INV_SQ, depth: -350, speed: PHI_INV, respawnDelay: FIB[5] * 1000 },
          { trigger: PHI_INV_SQ * 0.3, startX: -PHI_INV, startY: THIRD, targetX: -PHI_INV_SQ, targetY: -THIRD, depth: -480, speed: PHI_INV_SQ, respawnDelay: FIB[6] * 1000 },
          { trigger: PHI_INV_SQ, startX: TWO_THIRD, startY: PHI_INV_SQ, targetX: THIRD, targetY: -PHI_INV, depth: -400, speed: PHI_INV * 1.1, respawnDelay: FIB[4] * 2000 },
          { trigger: PHI_INV, startX: -TWO_THIRD, startY: PHI_INV_SQ, targetX: THIRD, targetY: -PHI_INV_SQ, depth: -360, speed: PHI_INV, respawnDelay: FIB[5] * 1200 },
          { trigger: 1 - PHI_INV, startX: PHI_INV + 0.1, startY: 0, targetX: -PHI_INV, targetY: -THIRD * 0.5, depth: -380, speed: PHI_INV_SQ * 1.5, respawnDelay: FIB[5] * 1400 },
          { trigger: PHI_INV + PHI_INV_SQ * 0.5, startX: -PHI_INV_SQ, startY: PHI_INV, targetX: PHI_INV_SQ, targetY: -PHI_INV, depth: -420, speed: PHI_INV_SQ, respawnDelay: FIB[6] * 1000 },
          { trigger: 1 - PHI_INV_SQ, startX: PHI_INV, startY: PHI_INV, targetX: 0, targetY: 0, depth: -300, speed: PHI_INV * 1.3, respawnDelay: FIB[4] * 1200 },
          { trigger: THIRD, startX: -1, startY: PHI_INV_SQ, targetX: 1, targetY: -PHI_INV_SQ, depth: -600, speed: PHI_INV_SQ * 0.4, respawnDelay: FIB[6] * 1500 }
        ];

        this.strategicPaths.forEach((path, i) => {
          const comet = this.createStrategicComet(i, path);
          this.cometPool.push(comet);
          this.scene.add(comet.mesh);
        });

        this.spawnedComets = new Set();
      }

      createStrategicComet(index, path) {
        const cfg = this.cometConfig;

        const positions = new Float32Array(cfg.tailSegments * 3);
        const alphas = new Float32Array(cfg.tailSegments);
        const sizes = new Float32Array(cfg.tailSegments);

        for (let i = 0; i < cfg.tailSegments; i++) {
          positions[i * 3] = -99999;
          positions[i * 3 + 1] = -99999;
          positions[i * 3 + 2] = -99999;

          const t = i / cfg.tailSegments;
          alphas[i] = Math.pow(1 - t, 2.5) * 0.5;
          sizes[i] = i === 0 ? 0.6 : (1 - Math.pow(t, 0.6)) * 2.0 + 0.15;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const hue = 0.12 + (index * 0.618033988749 * 0.08) % 0.1;
        const color = new THREE.Color().setHSL(hue, 0.25, 0.9);

        const material = new THREE.ShaderMaterial({
          uniforms: {
            baseColor: { value: color },
            pixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
          },
          vertexShader: `
            attribute float alpha;
            attribute float size;
            varying float vAlpha;
            uniform float pixelRatio;
            void main() {
              vAlpha = alpha;
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              if (position.x < -9999.0) {
                gl_PointSize = 0.0;
              } else {
                gl_PointSize = size * pixelRatio * (300.0 / max(-mvPosition.z, 1.0));
              }
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            uniform vec3 baseColor;
            varying float vAlpha;
            void main() {
              if (vAlpha < 0.01) discard;
              vec2 uv = gl_PointCoord - 0.5;
              float dist = length(uv);
              float core = exp(-dist * 12.0);
              float halo = exp(-dist * 4.0) * 0.15;
              float brightness = (core + halo) * vAlpha;
              if (brightness < 0.005) discard;
              gl_FragColor = vec4(baseColor, brightness);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });

        const mesh = new THREE.Points(geometry, material);
        mesh.frustumCulled = false;

        return {
          mesh,
          geometry,
          path,
          active: false,
          lorenz: { x: 0, y: 0, z: 0 },
          progress: 0,
          trail: [],
          life: 0,
          lastSpawn: -99999
        };
      }

      spawnStrategicComet(comet, now) {
        const path = comet.path;

        const seed = path.startX * 10 + path.startY * 7 + now * 0.0001;
        comet.lorenz = {
          x: 1 + Math.sin(seed) * 0.3,
          y: 1 + Math.cos(seed * PHI) * 0.3,
          z: 1 + Math.sin(seed * PHI * PHI) * 0.3
        };

        const aspect = window.innerWidth / window.innerHeight;
        const isMobile = window.innerWidth < 768;
        const isPortrait = aspect < 1;

        const scaleX = isPortrait ? 100 : 180 * Math.min(aspect, 1.8);
        const scaleY = isPortrait ? 150 : 120;

        const mobileCenter = isMobile ? 0.3 : 0;

        comet.startWorld = {
          x: (path.startX * (1 - mobileCenter)) * scaleX,
          y: path.startY * scaleY
        };
        comet.targetWorld = {
          x: (path.targetX * (1 - mobileCenter * 0.5)) * scaleX,
          y: path.targetY * scaleY
        };

        comet.progress = 0;
        comet.trail = [];
        comet.life = 0;
        comet.active = true;
        comet.lastSpawn = now;
      }

      updateComets() {
        const cfg = this.cometConfig;
        const now = performance.now();

        this.cometPool.forEach((comet) => {
          const path = comet.path;

          const shouldTrigger = this.scrollProgress >= path.trigger &&
                                this.scrollProgress < path.trigger + 0.3;

          if (shouldTrigger && !comet.active) {
            if (now - comet.lastSpawn > path.respawnDelay) {
              this.spawnStrategicComet(comet, now);
            }
          }

          if (!comet.active) return;

          // Advance Lorenz for chaos overlay
          const dt = 0.006;
          comet.lorenz = this.lorenzStep(comet.lorenz, dt, cfg.lorenz);

          comet.progress += 0.004 * path.speed;

          const eased = 1 - Math.pow(1 - Math.min(comet.progress, 1), 2.5);

          const chaosScale = 3 * (1 - eased);
          const baseX = comet.startWorld.x + (comet.targetWorld.x - comet.startWorld.x) * eased;
          const baseY = comet.startWorld.y + (comet.targetWorld.y - comet.startWorld.y) * eased;

          const worldPos = new THREE.Vector3(
            baseX + (comet.lorenz.x - 10) * chaosScale,
            baseY + (comet.lorenz.y - 15) * chaosScale + this.scrollProgress * -80,
            path.depth + (comet.lorenz.z - 25) * 0.5
          );

          comet.trail.unshift(worldPos);
          if (comet.trail.length > cfg.tailSegments) {
            comet.trail.pop();
          }

          const positions = comet.geometry.attributes.position.array;
          for (let i = 0; i < cfg.tailSegments; i++) {
            if (i < comet.trail.length) {
              positions[i * 3] = comet.trail[i].x;
              positions[i * 3 + 1] = comet.trail[i].y;
              positions[i * 3 + 2] = comet.trail[i].z;
            }
          }
          comet.geometry.attributes.position.needsUpdate = true;

          comet.life++;
          if (comet.progress > 1.2 || comet.life > 600) {
            comet.active = false;
            for (let i = 0; i < cfg.tailSegments * 3; i++) {
              positions[i] = -99999;
            }
            comet.geometry.attributes.position.needsUpdate = true;
          }
        });
      }

      // Lorenz attractor step
      lorenzStep(state, dt, params) {
        const { sigma, rho, beta } = params;
        return {
          x: state.x + sigma * (state.y - state.x) * dt,
          y: state.y + (state.x * (rho - state.z) - state.y) * dt,
          z: state.z + (state.x * state.y - beta * state.z) * dt
        };
      }

      setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        // Reduced bloom: strength 0.12 (was 0.2), radius 0.2 (was 0.3) - more subtle
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.12, 0.2, 0.8);
        this.composer.addPass(this.bloomPass);
      }

      animate() {
        requestAnimationFrame(() => this.animate());
        this.time += 0.016;

        this.scrollY += (this.targetScrollY - this.scrollY) * 0.06;
        const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
        this.scrollProgress = this.scrollY / maxScroll;

        this.mouseX += (this.targetMouseX - this.mouseX) * 0.04;
        this.mouseY += (this.targetMouseY - this.mouseY) * 0.04;

        const cameraZ = 5 - this.scrollProgress * 300;
        const cameraY = -this.scrollProgress * 150;

        // Reduced mouse parallax (was 60/25 - now 30/12 for subtler effect)
        const mouseParallaxX = this.mouseX * 30;
        const mouseParallaxY = this.mouseY * 12;

        this.camera.position.z = cameraZ;
        this.camera.position.y = cameraY + mouseParallaxY;
        this.camera.position.x = mouseParallaxX;

        // Stars follow but lag (distant)
        if (this.stars) {
          this.stars.material.uniforms.time.value = this.time;
          this.stars.position.x = mouseParallaxX * 0.15;
          this.stars.position.y = cameraY * 0.4 + mouseParallaxY * 0.1;
          this.stars.position.z = cameraZ * 0.3;
          this.stars.rotation.y = this.time * 0.001;
        }

        // Milky Way (very distant)
        if (this.milkyWay) {
          this.milkyWay.material.uniforms.time.value = this.time;
          this.milkyWay.position.x = mouseParallaxX * 0.08;
          this.milkyWay.position.y = cameraY * 0.15 + mouseParallaxY * 0.05;
          this.milkyWay.position.z = cameraZ * 0.1;
        }

        // Nebulae at different depths
        if (this.nebulae) {
          this.nebulae.forEach((nebula, i) => {
            nebula.material.uniforms.time.value = this.time;
            const depth = 0.2 + i * 0.12;
            nebula.position.x = nebula.userData.baseX + mouseParallaxX * (0.1 + i * 0.08);
            nebula.position.y = nebula.userData.baseY + cameraY * depth + mouseParallaxY * (0.08 + i * 0.04);
            nebula.position.z = nebula.userData.baseZ + cameraZ * depth * 0.4;
            nebula.lookAt(this.camera.position);
          });
        }

        // Cosmic dust (close, fast parallax)
        if (this.cosmicDust) {
          this.cosmicDust.material.uniforms.time.value = this.time;
          this.cosmicDust.material.uniforms.scrollOffset.value = this.scrollProgress * 400;
          this.cosmicDust.position.x = mouseParallaxX * 0.6;
          this.cosmicDust.position.y = cameraY * 0.85 + mouseParallaxY * 0.4;
          this.cosmicDust.position.z = cameraZ * 0.8;
        }

        this.updateComets();
        this.composer.render();
      }

      setupEventListeners() {
        window.addEventListener('scroll', () => { this.targetScrollY = window.scrollY; }, { passive: true });

        window.addEventListener('mousemove', (e) => {
          this.targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
          this.targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
          if (e.touches.length > 0) {
            this.targetMouseX = (e.touches[0].clientX / window.innerWidth - 0.5) * 2;
            this.targetMouseY = (e.touches[0].clientY / window.innerHeight - 0.5) * 2;
          }
        }, { passive: true });

        document.addEventListener('mouseleave', () => {
          this.targetMouseX = 0;
          this.targetMouseY = 0;
        });

        window.addEventListener('resize', () => {
          const w = window.innerWidth, h = window.innerHeight;
          this.camera.aspect = w / h;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(w, h);
          this.composer.setSize(w, h);
        });
      }
    }

    // Initialize
    new SpaceRenderer(document.getElementById('space-container'));

    // ========================================================================
    // BLACK HOLE SCROLL ANIMATION
    // ========================================================================
    const blackHole = document.getElementById('blackHole');
    let bhScrollY = 0, bhTargetY = 0;

    function updateBlackHole() {
      bhScrollY += (bhTargetY - bhScrollY) * 0.08;
      const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
      const progress = bhScrollY / maxScroll;

      const bottom = -40 + progress * 70;
      const scale = 1 + progress * 0.12;
      blackHole.style.bottom = `${bottom}vh`;
      blackHole.style.transform = `translateX(-50%) scale(${scale})`;

      requestAnimationFrame(updateBlackHole);
    }
    window.addEventListener('scroll', () => { bhTargetY = window.scrollY; }, { passive: true });
