import { useCallback, useState } from "react";

export function useHighScore(key: string): [number, (score: number) => void] {
  const [highScore, setHighScore] = useState<number>(() => {
    const stored = localStorage.getItem(key);
    return stored ? parseInt(stored, 10) || 0 : 0;
  });

  const update = useCallback(
    (score: number) => {
      if (score > highScore) {
        setHighScore(score);
        localStorage.setItem(key, String(score));
      }
    },
    [key, highScore],
  );

  return [highScore, update];
}
