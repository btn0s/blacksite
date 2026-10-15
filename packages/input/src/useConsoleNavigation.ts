import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useInputEvents, type OmniInputEvent } from "./omni-input"
type Direction = "up" | "down" | "left" | "right"
const selector = "button, input:not([type=hidden]), [role=slider]"
function controls(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      !element.matches(":disabled, [aria-disabled=true]") &&
      !element.closest("[inert], [hidden], fieldset:disabled") &&
      element.getClientRects().length > 0
  )
}
function visualOrder(a: HTMLElement, b: HTMLElement) {
  const x = a.getBoundingClientRect(),
    y = b.getBoundingClientRect()
  return x.top - y.top || x.left - y.left
}
function setValue(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set?.call(field, value)
  field.dispatchEvent(new Event("input", { bubbles: true }))
}
export function useConsoleNavigation<T extends HTMLElement = HTMLElement>(
  back?: () => void,
  changeSection?: (step: number) => void
) {
  const [panel, setPanel] = useState<T | null>(null)
  const [selected, setSelected] = useState<HTMLElement | null>(null)
  const selectionRef = useRef<HTMLElement | null>(null)
  const [editing, setEditing] = useState(false)
  const goBack = useEffectEvent(() => back?.())
  const changeTab = useEffectEvent((step: number) => {
    if (!changeSection) return false
    changeSection(step)
    return true
  })
  const dispatch = useRef<(event: OmniInputEvent) => void>(() => {})
  useInputEvents((event) => dispatch.current(event))
  useEffect(() => {
    if (!panel) return
    let editor: HTMLElement | null = null
    let original = ""
    const ownsSelection = () => {
      const modal = document.querySelector('[data-slot="dialog-content"]')
      return !modal || modal.contains(panel)
    }
    const select = (element: HTMLElement | undefined, scroll = true) => {
      if (!element || selectionRef.current === element) return
      selectionRef.current?.removeAttribute("data-console-selected")
      selectionRef.current?.removeAttribute("aria-current")
      selectionRef.current = element
      selectionRef.current.setAttribute("data-console-selected", "true")
      selectionRef.current.setAttribute("aria-current", "true")
      setSelected(selectionRef.current)
      selectionRef.current.dispatchEvent(
        new CustomEvent("console-select", { bubbles: true })
      )
      if (scroll)
        selectionRef.current.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "instant",
        })
    }
    const endEdit = (cancel = false) => {
      if (!editor) return
      if (cancel) {
        if (editor instanceof HTMLInputElement) setValue(editor, original)
        else
          editor.dispatchEvent(
            new CustomEvent("controller-cancel", { bubbles: true })
          )
      }
      editor.removeAttribute("data-controller-editing")
      if (editor instanceof HTMLInputElement) editor.blur()
      editor = null
      setEditing(false)
    }
    const beginEdit = (element: HTMLElement) => {
      if (editor === element) return
      endEdit()
      editor = element
      original = element instanceof HTMLInputElement ? element.value : ""
      element.setAttribute("data-controller-editing", "true")
      element.dispatchEvent(
        new CustomEvent("controller-edit", { bubbles: true })
      )
      if (
        element instanceof HTMLInputElement &&
        !["range", "checkbox", "radio"].includes(element.type)
      ) {
        element.focus({ preventScroll: true })
        if (element.type !== "number") element.select()
      }
      setEditing(true)
    }
    const ensureSelection = () => {
      const items = controls(panel)
      for (const item of items) item.tabIndex = -1
      if (
        !ownsSelection() ||
        document.querySelector('[data-slot="select-content"]')
      )
        return
      if (selectionRef.current && items.includes(selectionRef.current)) return
      if (editor && items.includes(editor)) {
        select(editor, false)
        return
      }
      endEdit()
      select(
        items.find((item) => item.hasAttribute("data-controller-default")) ??
          items.find((item) =>
            item.matches('[data-slot="tabs-trigger"][data-active]')
          ) ??
          items.sort(visualOrder)[0],
        false
      )
    }
    const move = (direction: Direction) => {
      if (editor) {
        const step = direction === "up" || direction === "right" ? 1 : -1
        if (editor instanceof HTMLInputElement && editor.type === "number") {
          const value = Number(editor.value) + step * Number(editor.step || 1)
          setValue(
            editor,
            String(
              Math.max(
                editor.min === "" ? -Infinity : Number(editor.min),
                Math.min(
                  editor.max === "" ? Infinity : Number(editor.max),
                  value
                )
              )
            )
          )
        } else
          editor.dispatchEvent(
            new CustomEvent("controller-adjust", {
              detail: step,
              bubbles: true,
            })
          )
        return
      }
      ensureSelection()
      if (!selectionRef.current) return
      const horizontal = direction === "left" || direction === "right"
      const sign = direction === "right" || direction === "down" ? 1 : -1
      const rect = selectionRef.current.getBoundingClientRect()
      const items = controls(panel)
        .filter((item) => item !== selectionRef.current)
        .map((item) => {
          const other = item.getBoundingClientRect()
          const dx = other.left + other.width / 2 - rect.left - rect.width / 2
          const dy = other.top + other.height / 2 - rect.top - rect.height / 2
          return {
            item,
            primary: (horizontal ? dx : dy) * sign,
            secondary: Math.abs(horizontal ? dy : dx),
          }
        })
      const forward = items
        .filter((item) => item.primary > 8)
        .sort(
          (a, b) => a.primary + a.secondary * 3 - b.primary - b.secondary * 3
        )
      const wrap = items.sort(
        (a, b) => a.primary - b.primary || a.secondary - b.secondary
      )
      select(forward[0]?.item ?? wrap[0]?.item)
    }
    const editable = (element: HTMLElement) =>
      element.matches(
        "input:not([type=checkbox]):not([type=radio]), [role=slider], [data-controller-field]"
      )
    const confirm = () => {
      ensureSelection()
      if (editor) {
        endEdit()
        return
      }
      if (!selectionRef.current) return
      if (editable(selectionRef.current)) beginEdit(selectionRef.current)
      else selectionRef.current.click()
    }
    const section = (step: number) => {
      endEdit()
      if (changeTab(step)) return
      const sections = Array.from(
        panel.querySelectorAll<HTMLElement>("[data-controller-section]")
      )
        .filter((item) => controls(item).length > 0)
        .sort(visualOrder)
      const index = sections.findIndex(
        (item) => selectionRef.current && item.contains(selectionRef.current)
      )
      const next = sections[(index + step + sections.length) % sections.length]
      if (next) select(controls(next).sort(visualOrder)[0])
    }
    dispatch.current = (event) => {
      if (!ownsSelection()) return
      if (event.targetId) {
        const target = controls(panel).find(
          (item) => item.dataset.omniId === event.targetId
        )
        if (target) {
          select(target, false)
          if (editable(target)) beginEdit(target)
        }
        return
      }
      const popup = document.querySelector<HTMLElement>(
        '[data-slot="select-content"]'
      )
      if (popup) {
        const items = Array.from(
          popup.querySelectorAll<HTMLElement>('[role="option"]')
        ).filter((item) => !item.hasAttribute("data-disabled"))
        const current = items.findIndex((item) =>
          item.hasAttribute("data-console-selected")
        )
        if (event.intent === "back")
          document
            .querySelector<HTMLElement>(
              '[data-slot="select-trigger"][aria-expanded="true"]'
            )
            ?.click()
        else if (event.intent === "confirm")
          (items[current] ?? items[0])?.click()
        else if (["up", "down", "left", "right"].includes(event.intent)) {
          const step = event.intent === "up" || event.intent === "left" ? -1 : 1
          const next = items[(current + step + items.length) % items.length]
          select(next)
        }
        return
      }
      if (event.intent === "confirm") confirm()
      if (event.intent === "back") {
        if (editor) endEdit(true)
        else {
          const cancel = new CustomEvent("console-back", {
            bubbles: true,
            cancelable: true,
          })
          const target = selectionRef.current ?? panel
          if (target.dispatchEvent(cancel)) goBack()
        }
      }
      if (event.intent === "previousSection") section(-1)
      if (event.intent === "nextSection") section(1)
      if (["up", "down", "left", "right"].includes(event.intent))
        move(event.intent as Direction)
    }
    const hover = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || editor || !ownsSelection()) return
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(selector)
          : null
      if (target && controls(panel).includes(target)) select(target, false)
    }
    const pointerDown = (event: PointerEvent) => {
      if (!ownsSelection()) return
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(selector)
          : null
      if (!target || !controls(panel).includes(target)) return
      select(target, false)
      if (editable(target)) beginEdit(target)
      else endEdit()
    }
    panel.addEventListener("pointermove", hover)
    panel.addEventListener("pointerdown", pointerDown)
    const observer = new MutationObserver(ensureSelection)
    observer.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden", "aria-disabled"],
    })
    ensureSelection()
    return () => {
      dispatch.current = () => {}
      endEdit()
      selectionRef.current?.removeAttribute("data-console-selected")
      selectionRef.current?.removeAttribute("aria-current")
      observer.disconnect()
      panel.removeEventListener("pointermove", hover)
      panel.removeEventListener("pointerdown", pointerDown)
    }
  }, [panel])
  return { root: setPanel, editing, selected }
}
