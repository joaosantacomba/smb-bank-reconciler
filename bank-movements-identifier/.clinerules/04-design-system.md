# SMB Reconciler - Design System & UI Rules

## 🎨 Global Styles
* **Color Palette:** Use standard Tailwind Grays.
    * **Background:** `bg-gray-50` for page background.
    * **Containers:** `bg-white` for all cards and sections.
    * **Text:** `text-gray-900` for headings, `text-gray-500` for helper text.
* **Border Radius:** Use `rounded-2xl` (1rem) for main cards and `rounded-lg` (0.5rem) for buttons/inputs.
* **Shadows:** Use `shadow-sm` for a very subtle elevation on cards.

## 🏗️ Layout Components
* **Header:** Fixed top section with `border-b border-gray-100`.
* **Navigation Tabs:**
    * **Container:** `bg-gray-100` or `bg-gray-200`, `rounded-full`, `p-1`.
    * **Active Tab:** `bg-white`, `shadow-sm`, `rounded-full`, `text-gray-900`.
    * **Inactive Tab:** `text-gray-500`, `hover:text-gray-700`.

## 📦 UI Elements
* **Main Card:** `bg-white border border-gray-100 rounded-2xl p-6 shadow-sm`.
* **Buttons:**
    * **Primary:** `bg-gray-900 text-white rounded-lg px-4 py-2 font-medium hover:bg-gray-800`.
    * **Secondary/Reset:** `bg-white border border-gray-200 text-gray-700 rounded-lg px-4 py-2`.
* **Form Inputs:** `bg-gray-50 border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-gray-200`.
* **Status Badges:**
    * **Mapped:** `text-green-600`.
    * **Possible:** `text-orange-600`.
    * **Unmapped:** `text-red-600`.

## 🗂️ Table Design
* **Header:** `text-xs font-semibold text-gray-400 uppercase tracking-wider py-3 px-4`.
* **Row:** `border-b border-gray-50 hover:bg-gray-50/50 transition-colors`.
* **Cell:** `py-4 px-4 text-sm text-gray-700`.

## 🌑 Empty States
* **Container:** Large centered area with `text-center py-12`.
* **Icon:** Large muted icon (`text-gray-300`, `w-16 h-16`).
* **Text:** `text-gray-400 mt-4 text-lg`.