import { useEffect, type ReactNode } from "react"

const interactive = 'button, a[href], input, textarea, select, iframe, [contenteditable="true"], [tabindex], [role="button"], [role="checkbox"], [role="slider"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [data-slot$="-trigger"], [data-slot$="-item"]'
let activeScopes = 0

function removeTabStops(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(interactive) && !root.hasAttribute("data-console-tabstop") && root.tabIndex !== -1) {
    root.setAttribute("tabindex", "-1")
  }
  root.querySelectorAll<HTMLElement>(interactive).forEach((element) => {
    if (!element.hasAttribute("data-console-tabstop") && element.tabIndex !== -1) {
      element.setAttribute("tabindex", "-1")
    }
  })
}

export function ConsoleScope({ children }: { children: ReactNode }) {
  useEffect(() => {
    activeScopes += 1
    document.documentElement.setAttribute("data-console-ui", "")
    removeTabStops(document)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          removeTabStops(mutation.target as Element)
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) removeTabStops(node)
          })
        }
      }
    })
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["tabindex", "role", "href", "contenteditable"],
    })
    return () => {
      observer.disconnect()
      activeScopes -= 1
      if (activeScopes === 0) document.documentElement.removeAttribute("data-console-ui")
    }
  }, [])
  return <>{children}</>
}
