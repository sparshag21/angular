/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {ɵɵelementEnd, ɵɵelementStart} from '../../../../src/render3/instructions/element';
import {createTNode, createTView} from '../../../../src/render3/instructions/shared';
import {ɵɵtext} from '../../../../src/render3/instructions/text';
import {RenderFlags} from '../../../../src/render3/interfaces/definition';
import {TNodeType, TViewNode} from '../../../../src/render3/interfaces/node';
import {resetComponentState} from '../../../../src/render3/state';
import {createBenchmark} from '../micro_bench';
import {createAndRenderLView} from '../setup';

`<div>
    <button>0</button>
    <button>1</button>
    <button>2</button>
    <button>3</button>
    <button>4</button>
    <button>5</button>
    <button>6</button>
    <button>7</button>
    <button>8</button>
    <button>9</button>
  </div>
</ng-template>`;
function testTemplate(rf: RenderFlags, ctx: any) {
  if (rf & 1) {
    ɵɵelementStart(0, 'div');
    ɵɵelementStart(1, 'button', 0);
    ɵɵtext(2, '0');
    ɵɵelementEnd();
    ɵɵelementStart(3, 'button', 0);
    ɵɵtext(4, '1');
    ɵɵelementEnd();
    ɵɵelementStart(5, 'button', 0);
    ɵɵtext(6, '2');
    ɵɵelementEnd();
    ɵɵelementStart(7, 'button', 0);
    ɵɵtext(8, '3');
    ɵɵelementEnd();
    ɵɵelementStart(9, 'button', 0);
    ɵɵtext(10, '4');
    ɵɵelementEnd();
    ɵɵelementStart(11, 'button', 0);
    ɵɵtext(12, '5');
    ɵɵelementEnd();
    ɵɵelementStart(13, 'button', 0);
    ɵɵtext(14, '6');
    ɵɵelementEnd();
    ɵɵelementStart(15, 'button', 0);
    ɵɵtext(16, '7');
    ɵɵelementEnd();
    ɵɵelementStart(17, 'button', 0);
    ɵɵtext(18, '8');
    ɵɵelementEnd();
    ɵɵelementStart(19, 'button', 0);
    ɵɵtext(20, '9');
    ɵɵelementEnd();
    ɵɵelementEnd();
  }
}

const viewTNode = createTNode(null !, null, TNodeType.View, -1, null, null) as TViewNode;
const embeddedTView = createTView(-1, testTemplate, 21, 0, null, null, null, null, [
  ['name1', 'value1', 'name2', 'value2', 'name3', 'value3', 'name4', 'value4', 'name5', 'value5']
]);

// initialize global state
resetComponentState();

// create view once so we don't profile first template pass
createAndRenderLView(null, embeddedTView, viewTNode);

// scenario to benchmark
const elementTextCreate = createBenchmark('element and text create');
const createTime = elementTextCreate('create');

console.profile('element_text_create');
while (createTime()) {
  for (let i = 0; i < 100000; i++) {
    createAndRenderLView(null, embeddedTView, viewTNode);
  }
}
console.profileEnd();

// report results
elementTextCreate.report();
