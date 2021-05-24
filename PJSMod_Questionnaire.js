/**************************
 * By: Evan Kirkiles      *
 * February 12, 2021      *
 **************************/

/* 
This module allows for easy implementation of any number of Demographic
surveys to be conducted in your psychoJS experiment. 
  
Example usage, where SURVEY_{1,2} are objects representing surveys as outlined
below in _generateSurveyQuestionLoop:

import { SurveyQuestionsModule } from './PJSMod_Questionnaire.js';

...
  
const SurveyQuestions = new SurveyQuestionsModule(psychoJS, expInfo, psiTurk);
flowScheduler.add(() => SurveyQuestions.initStimuli());
flowScheduler.add(() => SurveyQuestions.beginSurveySection());
SurveyQuestions.addSurveyQuestions(flowScheduler, SURVEY_1);
SurveyQuestions.addSurveyQuestions(flowScheduler, SURVEY_2);
  
...

*/

/* -------------------------------------------------------------------------
 * PsychoJS Imports
 * ------------------------------------------------------------------------- */

import { PsychoJS } from 'https://pavlovia.org/lib/core-3.2.js';
import { TrialHandler } from 'https://pavlovia.org/lib/data-3.2.js';
import { Scheduler } from 'https://pavlovia.org/lib/util-3.2.js';
import * as util from 'https://pavlovia.org/lib/util-3.2.js';
import * as visual from 'https://pavlovia.org/lib/visual-3.2.js';


/* -------------------------------------------------------------------------- */
/*                                  Constants                                 */
/* -------------------------------------------------------------------------- */

const SURVEY_CONTINUING = 0;
const SURVEY_SKIPPING = 1;
const SURVEY_BEGIN_SKIP = 2;

const TAKING_DISCRETE = 1; // Trial stage for discrete input
const TAKING_CONTINUOUS = 2; // Trial stage for continuous input
const DISPLAY_RESPONSE = 3; // Trial stage for displaying response with linger

/* --------------------------------------------------------------------------
 * Survey questions                                 
 * -------------------------------------------------------------------------- */

/**
 * Contains stuff for asking survey questions
 */
export class SurveyQuestionsModule {
  constructor(psychoJS, expInfo, psiTurk, clock) {
    this.psychoJS = psychoJS;
    this.psiTurk = psiTurk;
    this.expInfo = expInfo;
    this.clock = clock;
  }

  /**
   * Initializes the survey question stimuli
   */
  initStimuli() {
    this.question = _initQuestion(this.psychoJS);
    this.inputTypes = _initInputTypes(this.psychoJS);
    this.currentInput = undefined;
    return Scheduler.Event.NEXT;
  }

  /**
   * Displays text 
   */
  beginSurveySection() {
    if (this.question.status == PsychoJS.Status.NOT_STARTED) {
      this.question.setAutoDraw(true);
      this.psychoJS.eventManager.clearEvents();
    }
    let continueOn = false;
    let keys = this.psychoJS.eventManager.getKeys({keyList: ["enter", "return"]});
    if (keys.length > 0) {
      continueOn = true;
      this.question.text = '';
      this.question.setAutoDraw(false);
      this.question.status = PsychoJS.Status.NOT_STARTED;
      this.survey_run_status = SURVEY_CONTINUING;
      return Scheduler.Event.NEXT;
    }
    return Scheduler.Event.FLIP_REPEAT;
  }

  /**
   * Adds a survey question to a scheduler
   */
  addSurveyQuestions(flowScheduler, surveyResourceName) {
    const scheduler = new Scheduler(this.psychoJS);
    flowScheduler.add(this._generateSurveyQuestionsLoop(surveyResourceName), scheduler);
    flowScheduler.add(scheduler);
  }

  _generateSurveyQuestionsLoop(surveyResourceName) {
    /**
     * Schedules the given survey questions to ask, given a "questions" object
     * of the questions being desired to ask. Receives PsychoJS context stuff
     * through the context object, ie psychoJS instance and experiment info
     * 
     * survey = {
     *   set: ___,
     *   linger: ___,
     *   instructions: ___,
     *   questions: [
     *     {
     *       index: ___,
     *       question: ___,
     *       input: {
     *          type: ____ "DISCRETE", "CONTINUOUS"
     *          skips?: [
     *            {
     *              key: ___ Key for which to specify
     *              index: ___ Index of the question to skip to
     *            }
     *          ]
     *          specify?: [
     *            {
     *              key: ___ Key for which to add specify steps
     *              question: ____ Specify question
     *              inputs: [...] Like below, same structure as question
     *            }
     *          ]
     *          inputs?: [ This only is used if type is DISCRETE
     *            {
     *              key: ___ Key to select this option
     *              value: ___ Display value for this option
     *              label: ___ Display label for this option
     *            }
     *          ]
     *        }
     *     }
     *   ]
     * }
     */
  
    return (scheduler) => {
      let survey = this.psychoJS._serverManager.getResource(surveyResourceName);
      let trialIndices = survey.questions.map((question) => question.index);
      let trials = new TrialHandler({
        psychoJS: this.psychoJS,
        nReps: 1, method: TrialHandler.Method.SEQUENTIAL,
        extraInfo: this.expInfo, originPath: undefined,
        trialList: trialIndices,
        seed: undefined, name: survey.set
      })
      this.psychoJS.experiment.addLoop(trials);

      // Read question linger from survey
      this.linger = survey.linger;

      // Schedule the trials
      scheduler.add(() => { 
        this.survey_set = survey.set; 
        this.survey_run_status = SURVEY_CONTINUING;
        this.question.text = survey.instructions || '';
        return this._SurveyDisplayInstructions() });
      survey.questions.forEach((question) => {
        // Runs a survey question iteration
        scheduler.add(() => this._SurveyQuestionBegin(question));
        scheduler.add(() => this._SurveyQuestionLoop());
        scheduler.add(() => this._SurveyQuestionEnd());
        // Finishes a survey question iteration
        scheduler.add(() => {
          if (trials.finished) {
            if (Object.keys(this.psychoJS.experiment._thisEntry).length > 0) {
              this.psychoJS.experiment.nextEntry();
            }
            scheduler.stop();
          } else {
            this.psychoJS.experiment.nextEntry();
          }
          return Scheduler.Event.NEXT;
        });
      });
      return Scheduler.Event.NEXT;
    }
  }

  _buildLoopStimuli(question) {
    // Initialize the question being asked
    this.question.text = question.question;
    this.question.pos = [0, 0.4];
    this.currentInput = this.inputTypes[question.input.type];
    // In case of a discrete input
    if (question.input.type.includes("DISCRETE")) {
      this.currentInput.build(
        question.input.inputs, 
        question.input.specify || [],
        question.input.skips || []);
    // In case of a continuous input
    } else if (question.input.type.includes("CONTINUOUS")) {
      this.currentInput.build(
        question.input.keyList,
        question.input.maxLength,
        question.input.specify || []);
    }
  }

  _SurveyDisplayInstructions() {
    if (this.question.text == '') {
      return Scheduler.Event.NEXT;
    }
    if (this.question.status == PsychoJS.Status.NOT_STARTED) {
      this.question.pos = [0, 0];
      this.question.setAutoDraw(true);
    }
    let continueOn = false;
    let keys = this.psychoJS.eventManager.getKeys({keyList: ["enter", "return"]});
    if (keys.length > 0) {
      continueOn = true;
      this.question.text = '';
      this.question.setAutoDraw(false);
      this.question.status = PsychoJS.Status.NOT_STARTED;
      return Scheduler.Event.NEXT;
    }
    return Scheduler.Event.FLIP_REPEAT;
  }

  _SurveyQuestionBegin(question) {
    if (this.survey_run_status == SURVEY_SKIPPING) {
      if (this.question.index == this.skipIndex) {
        this.skipIndex = "none";
        this.survey_run_status = SURVEY_CONTINUING;
      } else {
        return Scheduler.Event.NEXT;
      }
    }

    // Initialize input-taking things
    this.clock.reset();
    this.psychoJS.eventManager.clearEvents();

    // Data being recorded for this question
    this.currentData = {
      survey: this.survey_set,
      question_index: question.index,
      question: question.question,
      question_type: question.input.type,
      choice: null,
      RT: null,
      value: null,
      specify: []
    }

    this.specify = {};
    this.skipIndex = "none";

    // 0: Haven't drawn question yet
    // 1: Question currently being answered
    // 2: Showing what user input
    this.trialStage = 0;

    // Build the loop stimuli for the given question
    this._buildLoopStimuli(question);

    return Scheduler.Event.NEXT;
  }

  /**
   * Asks one question of the survey
   * 
   * If the question is discrete, there is the option to add a specify field
   * which allows for chaining together of discrete questions with the potential
   * for a continuous question at the end.
   * 
   * If the question is continuous, only a specific section of the survey 
   * question loop is run which listens for user input.
   */
  _SurveyQuestionLoop() {
    if (this.survey_run_status == SURVEY_SKIPPING) {
      return Scheduler.Event.NEXT;
    }

    let continueRoutine = true;
    switch (this.trialStage) {
      // Haven't asked question, render current input
      case 0:
        this.question.setAutoDraw(true);
        this.currentInput.setAutoDraw(true);
        this.trialStage = this.currentInput.name == "CONTINUOUS" ? 
          TAKING_CONTINUOUS : TAKING_DISCRETE;
        break;
      // Waiting for user input on discrete input
      case TAKING_DISCRETE: {
          let input = this.psychoJS.eventManager.getKeys({keyList: this.currentInput.getKeys()});
          if (input.length > 0) {
            let key = input[0].name || input[0];
            let behavior = this.currentInput.optionSelected(key);
            if (this.currentData.choice == null) {
              this.currentData.choice = key;
              this.currentData.RT = this.clock.getTime();
              this.currentData.value = behavior.value;
            } else {
              this.currentData.specify.push({
                question: this.question.text,
                choice: key,
                RT: this.clock.getTime(),
                value: behavior.value
              });
            }
            this.specify = behavior.specify;
            if (behavior.skip) {
              this.skipIndex = behavior.skip.index;
            }
            this.trialStage = DISPLAY_RESPONSE;
            this.clock.reset();
          }
        }
        break;
      // User answered, taking specification input
      case TAKING_CONTINUOUS: {
          let input = this.psychoJS.eventManager.getKeys({keyList: this.currentInput.getKeys()});
          for (const key of input) {
            let keyName = input[0].name || input[0];
            if (keyName === 'return' || keyName === 'enter') {
              let behavior = this.currentInput.optionSelected();
              if (this.currentData.choice == null) {
                this.currentData.choice = undefined;
                this.currentData.RT = this.clock.getTime();
                this.currentData.value = behavior.value;
              } else {
                this.currentData.specify.push({
                  question: this.question.text,
                  choice: undefined,
                  RT: this.clock.getTime(),
                  value: behavior.value
                });
              }
              this.specify = behavior.specify;
              this.trialStage = DISPLAY_RESPONSE;
              this.clock.reset();
              break;
            } else {
              this.currentInput.keyIn(keyName);
            }
          }
        }
        break;
      // User answered, show what they answered
      case DISPLAY_RESPONSE:
        if (this.clock.getTime() >= this.linger) {
          this.currentInput.reset();
          // If no more specifies, the switch is done
          if (!this.specify) {
            // Check if skip was set
            if (this.skipIndex != "none") {
              this.survey_run_status = SURVEY_BEGIN_SKIP;
            }
            this.trialStage = -1;
          // Otherwise, reset the loop to the beginning
          } else {
            this._buildLoopStimuli(this.specify);
            this.psychoJS.eventManager.clearEvents();
            this.trialStage = 0;
          }
        }
        break;
      // Done with question
      default:
        this.question.setAutoDraw(false);
        continueRoutine = false;
        break;
    }

    if (continueRoutine) {
      return Scheduler.Event.FLIP_REPEAT;
    } else {
      return Scheduler.Event.NEXT;
    }
  }

  /**
   * Saves the survey question response and moves onto next question
   */
  _SurveyQuestionEnd() {
    if (this.survey_run_status == SURVEY_SKIPPING) {
      return Scheduler.Event.NEXT;
    } else if (this.survey_run_status == SURVEY_BEGIN_SKIP) {
      this.survey_run_status = SURVEY_SKIPPING;
    }

    // If there is a PsiTurk instance, we save the question as unstructured data
    if (this.psiTurk) {
      this.psiTurk.recordUnstructuredData(
        this.survey_set + '_' + this.currentData.question_index, 
        this.currentData);
    } else {
      this.psychoJS.experiment.addData(
        this.survey_set + '_' + this.currentData.question_index,  
        this.currentData);
    }
    this.currentData = {}
    return Scheduler.Event.NEXT;
  }
}

/* -------------------------------------------------------------------------- */
/*                                Input Classes                               */
/* -------------------------------------------------------------------------- */

// Inputs require the functions:
//  - getKeys
//  - build
//  - reset
//  - optionSelected
//  - setAutoDraw

/**
 * Handles discrete questions 
 */
class DiscreteInput {

  /* Inputs objects contains array of objects with three things:
    {
      key: The key to press to select this option
      value: The value displayed for this option
      label?: A label which is displayed next to the option
    } 
    Options must have a bunch of options:
    {
      showKeyAndValue: Render the key to press next to the value '(0) Yes'
      horizontalSpacing: How far apart to space options on the x
      verticalSpacing: How far apart to space options on the y
      initialPos: The initial central point for the questions
      height: The height of the texts
      unit: The unit of the inputs
      unactivatedColor: The resting color of the inputs
      activatedColor: The activated color of the inputs
      behavior: "highlight" to only highlight selected option, still show others
                "isolate" to only draw selected option, hids all others
    }
    */
  constructor(psychoJS, options) {
    this.psychoJS = psychoJS;
    this.options = options;
    this.name = "DISCRETE";
  }

  // Returns the list of keys 
  getKeys() { 
    return Object.keys(this.stimuli); 
  }

  // Builds all the input stimuli
  // specify signifies which input(s) to map to a text input box for more info
  // upon selection
  build(inputs, specify=[], skips=[]) {
    this.stimuli = {};
    this.specify = specify;
    this.skips = skips;
    let currentPos = [
      this.options.initialPos[0] - (this.options.horizontalSpacing * (1 + (Object.keys(inputs).length - 1) / 2)), 
      this.options.initialPos[1] + (this.options.verticalSpacing * (1 + (Object.keys(inputs).length - 1) / 2))];
    inputs.map((el) => {
      currentPos = [
        currentPos[0] + this.options.horizontalSpacing, 
        currentPos[1] - (this.options.verticalSpacing * (1 + (el.additionalLines || 0) * 0.2))];

      this.stimuli[el.key] = {
        key: el.key,
        value: el.value,
        stim: new visual.TextStim({
          win: this.psychoJS.window,
          text: this.options.showKeyAndValue ? '(' + el.key + ') ' + el.value : el.value,
          pos: currentPos,
          wrapWidth: this.options.verticalSpacing > 0 ? 2 : undefined,
          width: this.options.verticalSpacing > 0 ? 2 : undefined,
          height: this.options.height,
          units: this.options.units,
          color: this.options.unactivatedColor
        })
      }
    })
  }

  // Changes all the color back to unactivated and stops drawing
  reset() {
    Object.values(this.stimuli).forEach((el) => {
      el.stim.setAutoDraw(false);
      el.stim.color = this.options.unactivatedColor;
    });
  }

  // Makes all the inputs draw / not draw
  setAutoDraw(autoDraw) {
    Object.values(this.stimuli).forEach((el) => {
      el.stim.setAutoDraw(autoDraw);
      if (el.label) {
        el.label.setAutoDraw(autoDraw);
      }
    });
  }

  // Selects an option
  // If the returned 'specify' is not undefined, move on to a specifiication textinput
  optionSelected(key) {
    if (this.options.behavior === "isolate") {
      this.setAutoDraw(false);
      this.stimuli[key].stim.setAutoDraw(true);
    }
    this.stimuli[key].stim.color = this.options.activatedColor;
    let specifyObject = this.specify.find((el) => el["key"] == key);
    let skipObject = this.skips.find((el) => el["key"] == key);
    return {
      value: this.stimuli[key].value,
      specify: specifyObject,
      skip: skipObject
    };
  }
}

// Possible continuous keyLists
const LETTERS = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o',
  'p','q','r','s','t','u','v','w','x','y','z','minus','space'];
const FUNCTIONALITY = ['return', 'backspace', 'enter'];
const NUMBERS = ['0','1','2','3','4','5','6','7','8','9'];

/**
 * Handles continuous input 
 */
class ContinuousInput {
  constructor(psychoJS, options) {
    this.psychoJS = psychoJS;
    this.options = options;
    this.name = "CONTINUOUS";
    this.text = '';

    this.specify = [];
    this.keyList = [];
    this.maxLength = 0;
  }

  // Builds the continuous input
  build(keyList, maxLength=10, specify=[]) {
    this.keyList = keyList;
    this.maxLength = maxLength;
    this.specify = specify;
    this.stimuli = new visual.TextStim({
      win: this.psychoJS.window,
      text: '',
      pos: this.options.initialPos,
      height: this.options.height,
      units: this.options.units,
      color: this.options.color
    });
  }

  getKeys() {
    switch (this.keyList) {
      case "NUMBERS":
        return [...NUMBERS, ...FUNCTIONALITY];
      case "LETTERS":
        return [...LETTERS, ...FUNCTIONALITY];
      default:
        return [...NUMBERS, ...LETTERS, ...FUNCTIONALITY];
    }
  }

  // Removes the text
  reset() {
    this.stimuli.text = '';
    this.setAutoDraw(false);
  }

  // Makes all the inputs draw / not draw
  setAutoDraw(autoDraw) {
    this.stimuli.setAutoDraw(autoDraw);
  }

  // Sets the text on the continuous input
  keyIn(keyName) {
    if (keyName === 'backspace') {
      this.stimuli.text = this.stimuli.text.slice(0, -1);
    } else if (this.stimuli.text.length < this.maxLength) {
       if (keyName === 'space') {
        this.stimuli.text += ' ';
      } else if (keyName === 'minus') {
        this.stimuli.text += '-';
      } else {
        this.stimuli.text += keyName.toUpperCase();
      }
    }
  }

  // On user pressing enter
  optionSelected() {
    let specifyObject = this.specify.find(
      (el) => el["key"] == this.stimuli.text.toLowerCase());
    return {
      value: this.stimuli.text,
      specify: specifyObject
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                          Types of question inputs                          */
/* -------------------------------------------------------------------------- */

class BuiltDiscreteInput extends DiscreteInput {
  constructor(psychoJS, placement) {
    super(psychoJS, {
      horizontalSpacing: 0,
      verticalSpacing: 0.1,
      showKeyAndValue: true,
      initialPos: placement.initialPos,
      height: 0.05,
      units: 'height',
      unactivatedColor: new util.Color('black'),
      activatedColor: new util.Color('yellow'),
      behavior: 'isolate'
    })
  }
}
class BuiltContinuousInput extends ContinuousInput {
  constructor(psychoJS, placement) {
    super(psychoJS, {
      initialPos: placement.initialPos,
      height: 0.05,
      units: 'height',
      color: new util.Color('yellow')
    });
  } 
}


/* -------------------------------------------------------------------------- */
/*                               Survey stimuli                               */
/* -------------------------------------------------------------------------- */

function _initQuestion(psychoJS) {
  return new visual.TextStim({
      win: psychoJS.window,
      name: 'instrText',
      text: 'You will now be asked some survey questions.\nFeel free to take a break at this point.\nPress Enter to continue when you are ready.',
      units: 'height',
      pos: [0, 0], height: 0.05, wrapWidth: 1, ori: 0,
      color: new util.Color('black'), opacity: 1,
      depth: 0.0
  });
}

function _initInputTypes(psychoJS) {
  return {
    "DISCRETE": new BuiltDiscreteInput(psychoJS, {initialPos: [0, 0]}),
    "CONTINUOUS": new BuiltContinuousInput(psychoJS, {initialPos: [0, 0]})
  }
}