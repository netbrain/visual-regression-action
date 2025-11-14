interface ActionInputs {
    githubToken: string;
    playwrightCommand: string;
    workingDirectory: string;
    screenshotDirectory: string;
    baseBranch: string;
    commitScreenshots: boolean;
    postComment: boolean;
    useCiBranch: boolean;
    ciBranchName: string;
    diffThreshold: number;
    cropPadding: number;
    cropMinHeight: number;
    installDeps: boolean;
    failOnChanges: boolean;
    amendCommit: boolean;
}
export declare function getInputs(): ActionInputs;
export declare function run(): Promise<void>;
export declare function getImageDimensions(imagePath: string): Promise<{
    width: number;
    height: number;
}>;
export {};
//# sourceMappingURL=index.d.ts.map