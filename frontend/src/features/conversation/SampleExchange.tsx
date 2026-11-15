import { MathText } from '../../components/MathText'
import { ShaderBackground } from '../../components/ShaderBackground'

/**
 * A short example of Hetu at work, shown beside the first screen on wide
 * displays. It is written by hand and labelled as an example: no model ran.
 * Its parts appear one after another, or all at once with reduced motion.
 */
export function SampleExchange() {
  return (
    <figure className="relative flex h-full min-h-[30rem] flex-col justify-center overflow-hidden rounded-2xl border border-rule p-6 xl:p-8">
      <ShaderBackground />
      <div className="relative space-y-3">
        <div className="hero-step ml-auto w-fit max-w-[88%] rounded-lg border border-rule bg-surface px-4 py-3 shadow-sm [animation-delay:200ms]">
          <p className="eyebrow">You</p>
          <p className="mt-1 font-serif leading-relaxed">
            <MathText text="If $n^2$ is even, then $n$ is even. My proof: $n^2 = 2k$, so $n = \sqrt{2k}$, which is even." />
          </p>
        </div>
        <div className="hero-step max-w-[92%] rounded-lg border border-rule bg-paper px-4 py-3 shadow-sm [animation-delay:1100ms]">
          <p className="eyebrow text-accent">Hetu</p>
          <p className="mt-1 font-serif leading-relaxed">
            <MathText text="Your first step is fine. Look at the last one: why would $\sqrt{2k}$ be even? Try an odd $n$ and see what happens to $n^2$." />
          </p>
        </div>
        <div className="hero-step rounded-lg border border-rule bg-surface px-4 py-3 shadow-sm [animation-delay:2000ms]">
          <p className="eyebrow">Your argument, step by step</p>
          <ol role="list" className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <li className="rounded-md border border-dashed border-muted px-2 py-1">1 · Assume</li>
            <li aria-hidden="true" className="text-muted">
              →
            </li>
            <li className="rounded-md border border-muted px-2 py-1">2 · Infer</li>
            <li aria-hidden="true" className="text-muted">
              →
            </li>
            <li className="rounded-md border border-flag bg-flag-soft px-2 py-1">
              3 · Conclude <span className="ml-1 text-xs text-flag">Question</span>
            </li>
          </ol>
        </div>
      </div>
      <figcaption className="relative mt-4 text-xs text-muted">An example of how Hetu responds to a proof.</figcaption>
    </figure>
  )
}
