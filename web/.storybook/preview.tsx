import type { Preview } from "@storybook/react-vite"
import { TooltipProvider } from "@/components/ui/tooltip"
import "../src/index.css"

const preview: Preview = {
  globalTypes: {
    theme: { description: "Color theme", toolbar: { title: "Theme", items: ["light", "dark"], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light" },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story, context) => {
      document.documentElement.classList.toggle("dark", context.globals["theme"] === "dark")
      return <TooltipProvider><Story /></TooltipProvider>
    },
  ],
}

export default preview
