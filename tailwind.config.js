/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/index.html", "./public/camera.html", "./public/permission.html"],
  theme: {
    extend: {
      colors: {
        ink: "#17212f",
        paper: "#f4f6f9",
        sun: "#f5a623",
        leaf: "#18a689",
      },
      fontFamily: {
        display: ["Trebuchet MS", "sans-serif"],
        body: ["Trebuchet MS", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(18,38,63,.12)",
      },
    },
  },
  plugins: [],
};
