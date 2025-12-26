import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    '@solana/web3.js',
    '@solana/wallet-adapter-react',
  ],
  treeshake: true,
  splitting: false,
});
