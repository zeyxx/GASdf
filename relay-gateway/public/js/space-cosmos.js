import * as THREE from 'three';

export class SpaceCosmos {
  constructor(container) {
    this.container = container;
    this.time = 0;
    this.scrollY = 0;
    this.targetScrollY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetMouseX = 0;
    this.targetMouseY = 0;

    this.init();
    this.createStars();
    this.createNebulae();
    this.createComets();
    this.setupListeners();
    this.animate();
  }

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 3000);
    this.camera.position.z = 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x050508, 1);
    this.container.appendChild(this.renderer.domElement);
  }

  createStars() {
    const count = 10000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    // Harvard Spectral Colors
    const palette = [
      new THREE.Color(0x9bb0ff), // O/B Deep Blue
      new THREE.Color(0xcad7ff), // A Blue-White
      new THREE.Color(0xfff4e8), // F White
      new THREE.Color(0xffd2a1), // G/K Amber Gold
      new THREE.Color(0xff8a47), // M Crimson Flame
    ];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Spherical distribution around camera view
      const radius = 200 + Math.random() * 1600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);

      const color = palette[Math.floor(Math.random() * palette.length)];
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;

      // Noticeable visible sizes: 1.5px to 4.5px
      sizes[i] = 1.8 + Math.random() * 3.2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
      },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        varying float vGlow;
        uniform float time;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float pulse = 0.85 + 0.25 * sin(time * 2.0 + position.x * 0.05);
          gl_PointSize = size * pulse * (400.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vGlow = clamp(400.0 / -mvPosition.z, 0.4, 1.5);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vGlow;
        void main() {
          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;
          float intensity = pow(1.0 - dist * 2.0, 1.8);
          gl_FragColor = vec4(vColor, intensity * vGlow);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  createNebulae() {
    // Volumetric nebula clouds
    const count = 2500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Golden Spiral galaxy arm distribution
      const arm = (i % 3) * ((Math.PI * 2) / 3);
      const dist = Math.pow(Math.random(), 1.5) * 800;
      const angle = dist * 0.003 + arm;

      positions[i3] = Math.cos(angle) * dist + (Math.random() - 0.5) * 150;
      positions[i3 + 1] = (Math.random() - 0.5) * 80;
      positions[i3 + 2] = Math.sin(angle) * dist + (Math.random() - 0.5) * 150;

      // Amber / Flame / Violet nebula hues
      const t = Math.random();
      colors[i3] = t > 0.5 ? 0.95 : 0.4;
      colors[i3 + 1] = t > 0.5 ? 0.45 : 0.2;
      colors[i3 + 2] = t > 0.5 ? 0.15 : 0.8;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 18,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.nebulae = new THREE.Points(geometry, material);
    this.scene.add(this.nebulae);
  }

  createComets() {
    this.comets = [];
    for (let i = 0; i < 3; i++) {
      const geom = new THREE.BufferGeometry();
      const pos = new Float32Array(30 * 3);
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffaa44,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geom, mat);
      line.userData = {
        active: false,
        head: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        trail: [],
        cooldown: Math.random() * 200,
      };
      this.scene.add(line);
      this.comets.push(line);
    }
  }

  setupListeners() {
    window.addEventListener('scroll', () => {
      this.targetScrollY = window.scrollY;
    }, { passive: true });

    window.addEventListener('mousemove', (e) => {
      this.targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      this.targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.015;

    // Smooth camera inertia & scroll reaction
    this.scrollY += (this.targetScrollY - this.scrollY) * 0.05;
    this.mouseX += (this.targetMouseX - this.mouseX) * 0.04;
    this.mouseY += (this.targetMouseY - this.mouseY) * 0.04;

    this.camera.position.x = this.mouseX * 60;
    this.camera.position.y = -this.scrollY * 0.35 + this.mouseY * 30;
    this.camera.position.z = 600 - this.scrollY * 0.2;

    if (this.stars) {
      this.stars.material.uniforms.time.value = this.time;
      this.stars.rotation.y = this.time * 0.0005;
      this.stars.rotation.x = this.time * 0.0002;
    }

    if (this.nebulae) {
      this.nebulae.rotation.y = -this.time * 0.0012;
    }

    // Animate comets
    for (const c of this.comets) {
      const u = c.userData;
      if (!u.active) {
        u.cooldown--;
        if (u.cooldown <= 0) {
          u.active = true;
          u.head.set((Math.random() - 0.5) * 1200, 400 + Math.random() * 200, (Math.random() - 0.5) * 600);
          u.vel.set(-6 - Math.random() * 6, -5 - Math.random() * 4, -2 - Math.random() * 2);
          u.trail = [];
          u.cooldown = 300 + Math.random() * 400;
        }
      } else {
        u.head.add(u.vel);
        u.trail.unshift(u.head.clone());
        if (u.trail.length > 20) u.trail.pop();
        const pos = c.geometry.attributes.position.array;
        for (let i = 0; i < 20; i++) {
          if (i < u.trail.length) {
            pos[i * 3] = u.trail[i].x;
            pos[i * 3 + 1] = u.trail[i].y;
            pos[i * 3 + 2] = u.trail[i].z;
          }
        }
        c.geometry.attributes.position.needsUpdate = true;
        if (u.head.y < -500) u.active = false;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
