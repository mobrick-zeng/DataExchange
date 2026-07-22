/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 品牌主色：Apple Blue，沉穩、單一重點色
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#4da3ff',
          500: '#1a84ff', // hover
          600: '#0071e3', // 主要按鈕（Apple Blue）
          700: '#005bbb',
          800: '#004494',
          900: '#002d63',
        },
        // 淺色介面：Apple 招牌淺灰底 + 純白卡片
        surface: {
          DEFAULT: '#f5f5f7', // 頁面底（Apple 灰）
          raised: '#ffffff',
          card: '#ffffff',
          border: '#e3e3e8', // 極淡邊框
          muted: '#ececf1',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Noto Sans TC"',
          '"PingFang TC"',
          '"Microsoft JhengHei"',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        // Apple 式極淡陰影：靠留白與圓角撐版面，不靠重陰影
        card: '0 2px 12px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
}
