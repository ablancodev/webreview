// Configuración por defecto del motor. Todo es sobreescribible por CLI.
export const BREAKPOINTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

export const DEFAULTS = {
  maxPages: 20,          // tope de páginas a capturar (baseline sin lista curada)
  discoverMaxPages: 300, // tope de URLs a explorar en el descubrimiento
  breakpoints: ["desktop", "mobile"],
  navTimeoutMs: 30000,
  stabilizeMs: 800,      // espera extra tras estabilizar la página
  // Umbral de sensibilidad del diff por píxel (0 estricto - 1 laxo).
  pixelThreshold: 0.1,
  // % de píxeles cambiados a partir del cual marcamos la página como "cambiada".
  changeRatioAlert: 0.2,
};

// CSS que congela animaciones/transiciones y oculta cursores para
// estabilizar el render y reducir falsos positivos.
export const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  html { scroll-behavior: auto !important; }
`;
