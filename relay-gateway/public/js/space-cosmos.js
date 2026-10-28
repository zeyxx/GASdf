import * as THREE from 'three';

export class SpaceCosmos {
  constructor(container) {
    this.container = container;
    this.scrollY = 0;
    this.targetScrollY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetMouseX = 0;
    this.targetMouseY = 0;

    this.init();
    this.starTexture = this.generateStarTexture();
    this.createBackgroundStars();
    this.createForegroundConstellations();
    this.createCosmicNebula();
    this.setupListeners();
    this.animate();
  }

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 4000);
    this.camera.position.z = 1000;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x050508, 1);
    this.container.appendChild(this.renderer.domElement);
  }

  generateStarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(240, 245, 255, 0.9)');
    gradient.addColorStop(0.5, 'rgba(180, 210, 255, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  createBackgroundStars() {
    // 8,000 distinct, bright, solid stars
    const count = 8000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const colorPalette = [
      new THREE.Color('#ffffff'), // Crisp White
      new THREE.Color('#9bb0ff'), // Electric Blue
      new THREE.Color('#ffd2a1'), // Warm Amber
      new THREE.Color('#ff8a47'), // Crimson Gold
      new THREE.Color('#b388ff'), // Violet Nebula
    ];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Spread evenly in front of the camera across a 3D volume
      positions[i3] = (Math.random() - 0.5) * 2400;
      positions[i3 + 1] = (Math.random() - 0.5) * 2000;
      positions[i3 + 2] = (Math.random() - 0.5) * 1600;

      const c = colorPalette[Math.floor(Math.random() * colorPalette.length)];
      colors[i3] = c.r;
      colors[i3 + 1] = c.g;
      colors[i3 + 2] = c.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 7,
      map: this.starTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.bgStars = new THREE.Points(geometry, material);
    this.scene.add(this.bgStars);
  }

  createForegroundConstellations() {
    // 1,200 larger prominent glowing stars in near field
    const count = 1200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * 1800;
      positions[i3 + 1] = (Math.random() - 0.5) * 1600;
      positions[i3 + 2] = 200 + (Math.random() - 0.5) * 1000;

      // Bright white and golden stars
      colors[i3] = 1.0;
      colors[i3 + 1] = 0.95 + Math.random() * 0.05;
      colors[i3 + 2] = 0.8 + Math.random() * 0.2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 14,
      map: this.starTexture,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.fgStars = new THREE.Points(geometry, material);
    this.scene.add(this.fgStars);
  }

  createCosmicNebula() {
    // Dense galactic core stream of particles
    const count = 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const angle = (i / count) * Math.PI * 4;
      const radius = 100 + (i / count) * 900;

      positions[i3] = Math.cos(angle) * radius + (Math.random() - 0.5) * 150;
      positions[i3 + 1] = Math.sin(angle) * 200 + (Math.random() - 0.5) * 100;
      positions[i3 + 2] = (Math.random() - 0.5) * 600;

      // Amber and deep flame nebula colors
      const isAmber = Math.random() > 0.4;
      colors[i3] = isAmber ? 0.96 : 0.6;
      colors[i3 + 1] = isAmber ? 0.65 : 0.3;
      colors[i3 + 2] = isAmber ? 0.2 : 0.9;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 22,
      map: this.starTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.nebula = new THREE.Points(geometry, material);
    this.scene.add(this.nebula);
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

    // Inertial camera motion
    this.scrollY += (this.targetScrollY - this.scrollY) * 0.05;
    this.mouseX += (this.targetMouseX - this.mouseX) * 0.04;
    this.mouseY += (this.targetMouseY - this.mouseY) * 0.04;

    this.camera.position.x = this.mouseX * 80;
    this.camera.position.y = -this.scrollY * 0.4 + this.mouseY * 40;

    if (this.bgStars) {
      this.bgStars.rotation.y += 0.0003;
      this.bgStars.rotation.x += 0.0001;
    }

    if (this.fgStars) {
      this.fgStars.rotation.y += 0.0006;
      this.fgStars.rotation.x -= 0.0002;
    }

    if (this.nebula) {
      this.nebula.rotation.z += 0.0004;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
