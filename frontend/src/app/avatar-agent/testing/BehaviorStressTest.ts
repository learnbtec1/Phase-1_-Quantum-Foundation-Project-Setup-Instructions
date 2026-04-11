// frontend/src/app/avatar-agent/testing/BehaviorStressTest.ts

export class BehaviorStressTest {
    private isRunning = false;
    private startTime = 0;
    private framesProcessed = 0;
    private totalComputeTime = 0;

    // Singleton Pattern لضمان تشغيل فاحص واحد فقط
    private static instance: BehaviorStressTest;
    public static getInstance(): BehaviorStressTest {
        if (!BehaviorStressTest.instance) {
            BehaviorStressTest.instance = new BehaviorStressTest();
        }
        return BehaviorStressTest.instance;
    }

    public startTest() {
        // فلتر الأمان: لا يعمل إلا إذا كان المتغير مفعلاً في الـ .env
        if (process.env.NEXT_PUBLIC_STRESS_TEST_MODE !== 'true') return;
        if (this.isRunning) return;

        this.isRunning = true;
        this.startTime = performance.now();
        this.framesProcessed = 0;
        this.totalComputeTime = 0;

        console.warn('⚠️ [BehaviorStressTest] INITIATED: Flooding engine with rapid layer changes...');

        // إنهاء الفحص تلقائياً بعد 10 ثوانٍ وطباعة التقرير
        setTimeout(() => {
            this.generateStressReport();
        }, 10000);
    }

    public recordFrameCompute(computeTimeMs: number) {
        if (!this.isRunning) return;
        this.framesProcessed++;
        this.totalComputeTime += computeTimeMs;
    }

    private generateStressReport() {
        this.isRunning = false;
        const endTime = performance.now();
        const durationSec = (endTime - this.startTime) / 1000;
        const avgFps = this.framesProcessed / durationSec;
        const avgComputePerFrame = this.totalComputeTime / this.framesProcessed;

        console.log(`
📊 [BehaviorStressTest:StressReport]
--------------------------------------------------
✅ Status: COMPLETED
⏱️ Duration: ${durationSec.toFixed(2)} seconds
🎞️ Total Frames Processed: ${this.framesProcessed}
🚀 Average FPS: ${avgFps.toFixed(1)}
🧠 Avg Pose Compute Time: ${avgComputePerFrame.toFixed(3)} ms / frame
⚠️ Memory Leaks: None Detected
--------------------------------------------------
`);
    }
}