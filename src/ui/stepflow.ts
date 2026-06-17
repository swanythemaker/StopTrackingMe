// Carousel + step-bar controller. Owns the "which slide is showing" presentation concern:
// the sliding track, the animated container height, step-bar status, edit-mode morph, and a11y
// inerting of off-screen slides. The flow logic (when to advance) lives in main.ts.

export type Slide = 0 | 1 | 2; // 0 upload · 1 processing · 2 result

export class StepFlow {
  private carousel: HTMLElement;
  private track: HTMLElement;
  private slides: HTMLElement[];
  private stepUpload: HTMLElement;
  private stepClean: HTMLElement;
  private resultStage: HTMLElement;
  private current: Slide = 0;
  private editing = false;

  constructor(els: {
    carousel: HTMLElement;
    track: HTMLElement;
    slides: [HTMLElement, HTMLElement, HTMLElement];
    stepUpload: HTMLElement;
    stepClean: HTMLElement;
    resultStage: HTMLElement;
  }) {
    this.carousel = els.carousel;
    this.track = els.track;
    this.slides = els.slides;
    this.stepUpload = els.stepUpload;
    this.stepClean = els.stepClean;
    this.resultStage = els.resultStage;

    // Keep the container height glued to the active slide as its content reflows
    // (edit toggle, re-clean swapping a taller/shorter image, font load, etc.).
    const ro = new ResizeObserver(() => this.syncHeight());
    for (const s of this.slides) ro.observe(s);
    window.addEventListener("resize", () => this.syncHeight());

    this.apply(false);
  }

  get slide(): Slide {
    return this.current;
  }

  goTo(slide: Slide, opts: { focus?: boolean } = {}): void {
    this.current = slide;
    if (slide !== 2) this.editing = false;
    this.apply(opts.focus ?? false);
  }

  setEditing(on: boolean): void {
    this.editing = on;
    this.resultStage.classList.toggle("is-editing", on);
    this.syncHeight();
  }

  get isEditing(): boolean {
    return this.editing;
  }

  /** Recompute the container height to match the active slide. */
  syncHeight(): void {
    const active = this.slides[this.current];
    if (active) this.carousel.style.height = `${active.offsetHeight}px`;
  }

  private apply(focus: boolean): void {
    this.track.style.transform = `translateX(-${(100 / 3) * this.current}%)`;

    this.slides.forEach((s, i) => {
      const active = i === this.current;
      s.classList.toggle("is-active", active);
      // `inert` keeps off-screen slides out of tab order + a11y tree without display:none,
      // so we can still measure their height.
      if (active) s.removeAttribute("inert");
      else s.setAttribute("inert", "");
    });

    this.renderStepBar();
    this.syncHeight();

    if (focus) {
      const active = this.slides[this.current];
      active.setAttribute("tabindex", "-1");
      active.focus({ preventScroll: true });
    }
  }

  private renderStepBar(): void {
    const cleaned = this.current === 2;
    const inFlight = this.current === 1;

    // Step 1 (Upload): active on slide 0, done once we've moved past it.
    this.setStep(this.stepUpload, {
      active: this.current === 0,
      done: this.current > 0,
      locked: false,
    });

    // Step 2 (Clean image): locked until we leave upload; active while processing/result.
    this.setStep(this.stepClean, {
      active: inFlight || cleaned,
      done: cleaned,
      locked: this.current === 0,
    });

    this.carousel.dataset.slide = String(this.current);
  }

  private setStep(
    el: HTMLElement,
    state: { active: boolean; done: boolean; locked: boolean },
  ): void {
    el.classList.toggle("is-active", state.active && !state.done);
    el.classList.toggle("is-done", state.done);
    el.classList.toggle("is-locked", state.locked);
    if (state.active && !state.done) el.setAttribute("aria-current", "step");
    else el.removeAttribute("aria-current");
    if (state.locked) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
  }
}
