/**************************
 * By: Evan Kirkiles      *
 * May 7, 2021      *
 **************************/

/* 
This module allows for easy implementation of a series of instructions to be
added to your PsychoJS experiment.

Example usage, where INSTRUCTIONS_{1,2} are resource lists of your instructions:

import { InstructionsModule } from './PJSMod_Instructions.js';

...

var INSTRUCTIONS_1 = [{"name": "anything", path: "<YOUR PATH>"}, ...]
var INSTRUCTIONS_2 = [{"name": "anything2", path: "<YOUR PATH2>"}, ...]

...

const Instructions = new InstructionsModule(psychoJS, expInfo, psiTurk);
flowScheduler.add(() => Instructions.initStimuli());
...
Instructions.addInstructions(flowScheduler, INSTRUCTIONS_1, "instr1");
...
Instructions.addInstructions(flowScheduler, INSTRUCTIONS_2, "instr2");

...

psychoJS.start({
    ...
    resources: [
        ...,
        ...INSTRUCTIONS_1 <- note the destructuring of an array
    ]
})

*/

/* -------------------------------------------------------------------------
 * PsychoJS Imports
 * ------------------------------------------------------------------------- */

import { TrialHandler } from 'https://lib.pavlovia.org/data-2020.2.js';
import { Scheduler } from 'https://lib.pavlovia.org/util-2020.2.js';
import * as visual from 'https://lib.pavlovia.org/visual-2020.2.js';
import * as util from 'https://lib.pavlovia.org/util-2020.2.js';

/* -------------------------------------------------------------------------- */
/*                               Constants                                 */
/* -------------------------------------------------------------------------- */

var MAX_INSTRUCTIONS = 200; // Maximum loop of instructions before continuing on

/* -------------------------------------------------------------------------- */
/*                               Instructions                                 */
/* -------------------------------------------------------------------------- */

/**
 * Contains stuff for going through a set of instructions
 */
export class InstructionsModule {
    constructor(psychoJS, expInfo, psiTurk) {
        this.psychoJS = psychoJS;
        this.expInfo = expInfo;
        this.psiTurk = psiTurk;

        // Cached instructions, used so we can load multiple instructions lists
        // into a single Instructions object
        this.instructionsCache = {}
        // Current instructions object so each frame does not need to rerefrence
        this.currInstr = undefined;
        this.slideFinished = false;
    }

    /**
     * Initializes the instructions stimuli (just one image)
     */
    initStimuli(units='height', size=[1.0, 0.8]) {
        this.image = new visual.ImageStim({
            win: this.psychoJS.window,
            name: 'image', units: units,
            image: undefined, mask: undefined,
            ori: 0, pos: [0, 0], size: size,
            color: new util.Color([1, 1, 1]), opacity: 1
        });
        return Scheduler.Event.NEXT;
    }

    /**
     * Adds a set of instructions to a scheduler from a list of instruction resources.
     * We ask for instructionsName because we need to separate between different
     * runs of instructions which use the same underlying PsychoJS image stim.
     */
    addInstructions(flowScheduler, instructionsResources, instructionsName) {
        const scheduler = new Scheduler(this.psychoJS);
        flowScheduler.add(this._generateInstructionsLoop(instructionsResources, instructionsName), scheduler);
        flowScheduler.add(scheduler);
    }

    /**
     * Generates the PsychoJS loop of the instructions, given a list of instruction
     * resources passed in.
     */
    _generateInstructionsLoop(instructionsResources, instructionsName) {
        this.instructionsCache[instructionsName] = {
            "resources": instructionsResources,
            "currentIndex": 0
        }
        return (scheduler) => {
            let trials = new TrialHandler({
                psychoJS: this.psychoJS,
                nReps: MAX_INSTRUCTIONS, method: TrialHandler.Method.SEQUENTIAL,
                extraInfo: this.expInfo, originPath: undefined,
                trialList: undefined,
                seed: undefined, name: instructionsName
            });
            this.psychoJS.experiment.addLoop(trials);

            // Schedule all the trials, we don't care about saving any data
            for (const _ of trials) {
                scheduler.add(() => this._InstructionsRoutineBegin(instructionsName));
                scheduler.add(() => this._InstructionsRoutineEachFrame());
                scheduler.add(() => this._InstructionsRoutineEnd());
                // If the end condition is met (at end of instructions, return)
                scheduler.add(() => {
                    if (this.currInstr.currentIndex == -1) { 
                        scheduler.stop(); 
                    }
                    return Scheduler.Event.NEXT;
                });
            }

            // Move on to the next event
            return Scheduler.Event.NEXT;
        };
    }


    /**
     * Run on each loop of instructions, simply sets the image
     */
    _InstructionsRoutineBegin(instructionsName) {
        this.currInstr = this.instructionsCache[instructionsName];
        // Build the image for this stage of the instructios
        this.image.setImage(this.currInstr.resources[this.currInstr.currentIndex]["name"]);
        this.image.setAutoDraw(true);
        // Slide has not finished
        this.slideFinished = false;
        return Scheduler.Event.NEXT;
    }

    /**
     * Called each frame of the instructions routine
     */
    _InstructionsRoutineEachFrame() {
        // Update'/raw components on each frame
        let buttonPress = this.psychoJS.eventManager.getKeys({"keyList": ["b", "n", "f"]});
        if (buttonPress.length > 0) {
            // User pressed "next" instructions
            if ((buttonPress[0] === "n") && (this.currInstr.currentIndex < this.currInstr.resources.length - 1)) {
                this.slideFinished = true;
                this.currInstr.currentIndex += 1;
            } else if ((buttonPress[0] === "b") && (this.currInstr.currentIndex > 0)) {
                this.slideFinished = true;
                this.currInstr.currentIndex -= 1;
            } else if ((buttonPress[0] === "f") && (this.currInstr.currentIndex === this.currInstr.resources.length - 1)) {
                this.slideFinished = true;
                this.currInstr.currentIndex = -1;
            }
            this.psychoJS.eventManager.clearEvents();
        }

        // If the image has finished turn it off and go next
        if (this.slideFinished) {
            return Scheduler.Event.NEXT;
        // Otherwise, continue to show the instruction
        } else {
            return Scheduler.Event.FLIP_REPEAT;
        }
    }

    /**
     * Terminates an instruction's run by turning off the image
     */
    _InstructionsRoutineEnd() {
        this.image.setAutoDraw(false);
        return Scheduler.Event.NEXT;
    }
}