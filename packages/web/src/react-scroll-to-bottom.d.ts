declare module "react-scroll-to-bottom" {
  import * as React from "react";

  export const Composer: React.ComponentType<{
    checkInterval?: number;
    initialScrollBehavior?: "auto" | "smooth";
    mode?: "bottom" | "top";
    children?: React.ReactNode;
  }>;

  export const Panel: React.ComponentType<{
    className?: string;
    children?: React.ReactNode;
  }>;

  export function useScrollToBottom(): () => void;
  export function useSticky(): [boolean];

  const ScrollToBottom: React.ComponentType<{
    className?: string;
    children?: React.ReactNode;
    checkInterval?: number;
    initialScrollBehavior?: "auto" | "smooth";
    followButtonClassName?: string;
    scrollViewClassName?: string;
  }>;

  export default ScrollToBottom;
}
