# David Boring

An interactive web experience with pose detection and Cesium integration.

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file (copy from `.env.example`) and add your Cesium Ion token:
   ```
   VITE_CESIUM_TOKEN="your_cesium_token_here"
   ```

## Development

Start the development server:

```bash
npm run dev
```

Notes about environment variables:

- Vite exposes client env variables that start with `VITE_` via `import.meta.env.VITE_...`.
- If you already have a top-level `.env` file (not checked into git), keep your `CESIUM` token there as `VITE_CESIUM_TOKEN` and update calls in `sketch.js` to use `import.meta.env.VITE_CESIUM_TOKEN` if needed.

## Build for Production

Create a production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

- `src/js/`: JavaScript files
- `src/css/`: CSS files
- `src/assets/`: Images and other assets
- `public/`: Static files (will be copied as-is to dist)
- `index.html`: Main HTML file
- `vite.config.js`: Vite configuration

## Environment Variables

All environment variables are defined in the `.env` file and must be prefixed with `VITE_` to be exposed to the client code.

## License

This project is licensed under the ISC License.
