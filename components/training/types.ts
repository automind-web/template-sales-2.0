export type CourseSummary = {
    id: string;
    key: string;
    title: string;
    description: string | null;
    version: number;
    lessons: { total: number; completed: number; percent: number };
    questions: number;
    requiredForAdmission: boolean;
    minScorePercent: number;
    bestPercent: number | null;
    passed: boolean;
    attempts: number;
    openAttempt: { id: string; version: number } | null;
};

export type RuleStatus = { courseKey: string; minScorePercent: number; bestPercent: number | null; satisfied: boolean; courseAvailable: boolean };

export type MyCourses = { courses: CourseSummary[]; admission: { admitted: boolean; rules: RuleStatus[]; missingCourses: string[] } };

export type AttemptView = {
    id: string;
    courseId: string;
    status: "in_progress" | "submitted";
    version: number;
    latestVersion: number;
    title: string;
    questions: Array<{ key: string; text: string; kind: "single" | "multiple"; options: Array<{ key: string; text: string }> }>;
    answers: Record<string, string[]>;
    result: { correct: number; total: number; percent: number; minScorePercent: number; passed: boolean } | null;
};
