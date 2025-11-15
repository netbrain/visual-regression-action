interface CaptureInputs {
    mode: 'capture';
    playwrightCommand: string;
    workingDirectory: string;
    screenshotDirectory: string;
    artifactName: string;
    installDeps: boolean;
}
interface CompareInputs {
    mode: 'compare';
    githubToken: string;
    workingDirectory: string;
    baseArtifact: string;
    prArtifact: string;
    postComment: boolean;
    diffThreshold: number;
    cropPadding: number;
    cropMinHeight: number;
    failOnChanges: boolean;
    r2AccountId: string;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    r2BucketName: string;
    r2PublicUrl: string;
    outputFormat: 'side-by-side' | 'animated-gif';
    gifFrameDelay: number;
    includeDiffInOutput: boolean;
}
type ActionInputs = CaptureInputs | CompareInputs;
export declare function getInputs(): ActionInputs;
export declare function runCapture(inputs: CaptureInputs): Promise<void>;
export declare function runCompare(inputs: CompareInputs): Promise<void>;
export declare function getImageDimensions(imagePath: string): Promise<{
    width: number;
    height: number;
}>;
export declare function run(): Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map