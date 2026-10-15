import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { fitGameFrame, type GameFrameFit, type GameFrameRatio, type GameFrameRect } from "./fit"

const GameFrameContext = createContext<GameFrameRect | null>(null)

export function useGameFrame(): GameFrameRect {
  const frame = useContext(GameFrameContext)
  if (!frame) throw new Error("useGameFrame must be used inside GameFrame")
  return frame
}

export function GameFrameSafeArea({ children, style, ...props }: { children: ReactNode; style?: CSSProperties } & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "style">) {
  return (
    <div
      data-game-frame-safe=""
      tabIndex={-1}
      style={{
        position: "absolute",
        top: "max(env(safe-area-inset-top, 0px), var(--bleed-t, 0px))",
        right: "max(env(safe-area-inset-right, 0px), var(--bleed-r, 0px))",
        bottom: "max(env(safe-area-inset-bottom, 0px), var(--bleed-b, 0px))",
        left: "max(env(safe-area-inset-left, 0px), var(--bleed-l, 0px))",
        zIndex: 1,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export interface GameFrameProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  children: ReactNode
  ratio?: GameFrameRatio
  fit?: GameFrameFit
}

function GameFrameRoot({ children, ratio = "16/9", fit = "contain", style, ...props }: GameFrameProps) {
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const frame = fitGameFrame(size.width, size.height, ratio, fit)
  return (
    <GameFrameContext value={frame}>
      <div
        ref={root}
        data-game-frame=""
        tabIndex={-1}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "var(--game-frame-bar, black)",
          ...style,
        }}
        {...props}
      >
        <div
          data-game-frame-stage=""
          style={{ position: "relative", flex: "none", width: frame.width, height: frame.height }}
        >
          <div data-game-frame-content="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            {children}
          </div>
        </div>
      </div>
    </GameFrameContext>
  )
}

export const GameFrame = Object.assign(GameFrameRoot, { SafeArea: GameFrameSafeArea })
