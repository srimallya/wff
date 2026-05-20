export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#E30613',
        swiss: {
          red: '#E30613',
          black: '#111111',
          paper: '#F7F5EF',
          white: '#FFFFFF',
          gray: '#6B6F76',
          blue: '#0057B8',
          yellow: '#FFCC00',
        },
        dark: {
          bg: '#F7F5EF',
          card: '#FFFFFF',
          border: '#D8D5C7'
        }
      },
      fontFamily: {
        sans: ['Avenir Next', 'Avenir', 'Helvetica Neue', 'Arial', 'sans-serif'],
        serif: ['Avenir Next', 'Avenir', 'Helvetica Neue', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
