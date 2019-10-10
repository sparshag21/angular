/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as ts from 'typescript';

import {absoluteFrom as _} from '../../src/ngtsc/file_system';
import {runInEachFileSystem} from '../../src/ngtsc/file_system/testing';
import {loadStandardTestFiles} from '../helpers/src/mock_file_loading';

import {NgtscTestEnvironment} from './env';

const testFiles = loadStandardTestFiles();

runInEachFileSystem(() => {
  describe('ngtsc type checking', () => {
    let env !: NgtscTestEnvironment;

    beforeEach(() => {
      env = NgtscTestEnvironment.setup(testFiles);
      env.tsconfig({fullTemplateTypeCheck: true});
      env.write('node_modules/@angular/common/index.d.ts', `
import * as i0 from '@angular/core';

export declare class NgForOfContext<T> {
  $implicit: T;
  ngForOf: T[];
  index: number;
  count: number;
  readonly first: boolean;
  readonly last: boolean;
  readonly even: boolean;
  readonly odd: boolean;
}

export declare class IndexPipe {
  transform<T>(value: T[], index: number): T;

  static ngPipeDef: i0.ɵPipeDefWithMeta<IndexPipe, 'index'>;
}

export declare class NgForOf<T> {
  ngForOf: T[];
  static ngTemplateContextGuard<T>(dir: NgForOf<T>, ctx: any): ctx is NgForOfContext<T>;
  static ngDirectiveDef: i0.ɵɵDirectiveDefWithMeta<NgForOf<any>, '[ngFor][ngForOf]', never, {'ngForOf': 'ngForOf'}, {}, never>;
}

export declare class NgIf {
  ngIf: any;
  static ngTemplateGuard_ngIf: 'binding';
  static ngDirectiveDef: i0.ɵɵDirectiveDefWithMeta<NgForOf<any>, '[ngIf]', never, {'ngIf': 'ngIf'}, {}, never>;
}

export declare class CommonModule {
  static ngModuleDef: i0.ɵɵNgModuleDefWithMeta<CommonModule, [typeof NgIf, typeof NgForOf, typeof IndexPipe], never, [typeof NgIf, typeof NgForOf, typeof IndexPipe]>;
}
`);
    });

    it('should check a simple component', () => {
      env.write('test.ts', `
    import {Component, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: 'I am a simple template with no type info',
    })
    class TestCmp {}

    @NgModule({
      declarations: [TestCmp],
    })
    class Module {}
    `);

      env.driveMain();
    });

    it('should check basic usage of NgIf', () => {
      env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: '<div *ngIf="user">{{user.name}}</div>',
    })
    class TestCmp {
      user: {name: string}|null;
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    class Module {}
    `);

      env.driveMain();
    });

    it('should check usage of NgIf with explicit non-null guard', () => {
      env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: '<div *ngIf="user !== null">{{user.name}}</div>',
    })
    class TestCmp {
      user: {name: string}|null;
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    class Module {}
    `);

      env.driveMain();
    });

    it('should check basic usage of NgFor', () => {
      env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: '<div *ngFor="let user of users">{{user.name}}</div>',
    })
    class TestCmp {
      users: {name: string}[];
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    class Module {}
    `);

      env.driveMain();
    });

    it('should report an error inside the NgFor template', () => {
      env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: '<div *ngFor="let user of users">{{user.does_not_exist}}</div>',
    })
    export class TestCmp {
      users: {name: string}[];
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    export class Module {}
    `);

      const diags = env.driveDiagnostics();
      expect(diags.length).toBe(1);
      expect(diags[0].messageText)
          .toEqual(`Property 'does_not_exist' does not exist on type '{ name: string; }'.`);
      expect(diags[0].start).toBe(199);
      expect(diags[0].length).toBe(19);
    });

    it('should accept an NgFor iteration over an any-typed value', () => {
      env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: '<div *ngFor="let user of users">{{user.name}}</div>',
    })
    export class TestCmp {
      users: any;
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    export class Module {}
    `);

      env.driveMain();
    });

    it('should report an error with pipe bindings', () => {
      env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: \`
        checking the input type to the pipe:
        {{user | index: 1}}

        checking the return type of the pipe:
        {{(users | index: 1).does_not_exist}}

        checking the argument type:
        {{users | index: 'test'}}

        checking the argument count:
        {{users | index: 1:2}}
      \`
    })
    class TestCmp {
      user: {name: string};
      users: {name: string}[];
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    class Module {}
    `);

      const diags = env.driveDiagnostics();
      expect(diags.length).toBe(4);

      const allErrors = [
        `'does_not_exist' does not exist on type '{ name: string; }'`,
        `Expected 2 arguments, but got 3.`,
        `Argument of type '"test"' is not assignable to parameter of type 'number'`,
        `Argument of type '{ name: string; }' is not assignable to parameter of type 'unknown[]'`,
      ];

      for (const error of allErrors) {
        if (!diags.some(
                diag =>
                    ts.flattenDiagnosticMessageText(diag.messageText, '').indexOf(error) > -1)) {
          fail(`Expected a diagnostic message with text: ${error}`);
        }
      }
    });

    it('should constrain types using type parameter bounds', () => {
      env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, Input, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: '<div *ngFor="let user of users">{{user.does_not_exist}}</div>',
    })
    class TestCmp<T extends {name: string}> {
      @Input() users: T[];
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    class Module {}
    `);

      const diags = env.driveDiagnostics();
      expect(diags.length).toBe(1);
      expect(diags[0].messageText).toEqual(`Property 'does_not_exist' does not exist on type 'T'.`);
      expect(diags[0].start).toBe(206);
      expect(diags[0].length).toBe(19);
    });

    it('should property type-check a microsyntax variable with the same name as the expression',
       () => {
         env.write('test.ts', `
    import {CommonModule} from '@angular/common';
    import {Component, Input, NgModule} from '@angular/core';

    @Component({
      selector: 'test',
      template: '<div *ngIf="foo as foo">{{foo}}</div>',
    })
    export class TestCmp<T extends {name: string}> {
      foo: any;
    }

    @NgModule({
      declarations: [TestCmp],
      imports: [CommonModule],
    })
    export class Module {}
    `);

         const diags = env.driveDiagnostics();
         expect(diags.length).toBe(0);
       });

    it('should properly type-check inherited directives', () => {
      env.write('test.ts', `
    import {Component, Directive, Input, NgModule} from '@angular/core';

    @Directive({
      selector: '[base]',
    })
    class BaseDir {
      @Input() fromBase!: string;
    }

    @Directive({
      selector: '[child]',
    })
    class ChildDir extends BaseDir {
      @Input() fromChild!: boolean;
    }

    @Component({
      selector: 'test',
      template: '<div child [fromBase]="3" [fromChild]="4"></div>',
    })
    class TestCmp {}

    @NgModule({
      declarations: [TestCmp, ChildDir],
    })
    class Module {}
    `);

      const diags = env.driveDiagnostics();
      expect(diags.length).toBe(2);
      expect(diags[0].messageText)
          .toBe(`Type 'number' is not assignable to type 'string | undefined'.`);
      expect(diags[0].start).toEqual(386);
      expect(diags[0].length).toEqual(14);
      expect(diags[1].messageText)
          .toBe(`Type 'number' is not assignable to type 'boolean | undefined'.`);
      expect(diags[1].start).toEqual(401);
      expect(diags[1].length).toEqual(15);
    });

    describe('legacy schema checking with the DOM schema', () => {
      beforeEach(
          () => { env.tsconfig({ivyTemplateTypeCheck: true, fullTemplateTypeCheck: false}); });

      it('should check for unknown elements', () => {
        env.write('test.ts', `
        import {Component, NgModule} from '@angular/core';
        @Component({
          selector: 'blah',
          template: '<foo>test</foo>',
        })
        export class FooCmp {}
        @NgModule({
          declarations: [FooCmp],
        })
        export class FooModule {}
      `);
        const diags = env.driveDiagnostics();
        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(`'foo' is not a valid HTML element.`);
      });

      it('should check for unknown properties', () => {
        env.write('test.ts', `
        import {Component, NgModule} from '@angular/core';
        @Component({
          selector: 'blah',
          template: '<div [foo]="1">test</div>',
        })
        export class FooCmp {}
        @NgModule({
          declarations: [FooCmp],
        })
        export class FooModule {}
      `);
        const diags = env.driveDiagnostics();
        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(`'foo' is not a valid property of <div>.`);
      });

      it('should convert property names when binding special properties', () => {
        env.write('test.ts', `
        import {Component, NgModule} from '@angular/core';
        @Component({
          selector: 'blah',
          template: '<label [for]="test">',
        })
        export class FooCmp {
          test: string = 'test';
        }
        @NgModule({
          declarations: [FooCmp],
        })
        export class FooModule {}
      `);
        const diags = env.driveDiagnostics();
        // Should not be an error to bind [for] of <label>, even though the actual property in the
        // DOM schema.
        expect(diags.length).toBe(0);
      });

      it('should produce diagnostics for custom-elements-style elements when not using the CUSTOM_ELEMENTS_SCHEMA',
         () => {
           env.write('test.ts', `
          import {Component, NgModule} from '@angular/core';
          @Component({
            selector: 'blah',
            template: '<custom-element [foo]="1">test</custom-element>',
          })
          export class FooCmp {}
          @NgModule({
            declarations: [FooCmp],
          })
          export class FooModule {}
      `);
           const diags = env.driveDiagnostics();
           expect(diags.length).toBe(2);
           expect(diags[0].messageText).toBe(`'custom-element' is not a valid HTML element.`);
           expect(diags[1].messageText).toBe(`'foo' is not a valid property of <custom-element>.`);
         });

      it('should not produce diagnostics for custom-elements-style elements when using the CUSTOM_ELEMENTS_SCHEMA',
         () => {
           env.write('test.ts', `
            import {Component, NgModule, CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
      
            @Component({
              selector: 'blah',
              template: '<custom-element [foo]="1">test</custom-element>',
            })
            export class FooCmp {}
      
            @NgModule({
              declarations: [FooCmp],
              schemas: [CUSTOM_ELEMENTS_SCHEMA],
            })
            export class FooModule {}
          `);
           const diags = env.driveDiagnostics();
           expect(diags).toEqual([]);
         });

      it('should not produce diagnostics when using the NO_ERRORS_SCHEMA', () => {
        env.write('test.ts', `
        import {Component, NgModule, NO_ERRORS_SCHEMA} from '@angular/core';
  
        @Component({
          selector: 'blah',
          template: '<foo [bar]="1"></foo>',
        })
        export class FooCmp {}
  
        @NgModule({
          declarations: [FooCmp],
          schemas: [NO_ERRORS_SCHEMA],
        })
        export class FooModule {}
      `);
        const diags = env.driveDiagnostics();
        expect(diags).toEqual([]);
      });
    });

    // Test both sync and async compilations, see https://github.com/angular/angular/issues/32538
    ['sync', 'async'].forEach(mode => {
      describe(`error locations [${mode}]`, () => {
        let driveDiagnostics: () => Promise<ReadonlyArray<ts.Diagnostic>>;
        beforeEach(() => {
          if (mode === 'async') {
            env.enablePreloading();
            driveDiagnostics = () => env.driveDiagnosticsAsync();
          } else {
            driveDiagnostics = () => Promise.resolve(env.driveDiagnostics());
          }
        });

        it('should be correct for direct templates', async() => {
          env.write('test.ts', `
          import {Component, NgModule} from '@angular/core';
      
          @Component({
            selector: 'test',
            template: \`<p>
              {{user.does_not_exist}}
            </p>\`,
          })
          export class TestCmp {
            user: {name: string}[];
          }`);

          const diags = await driveDiagnostics();
          expect(diags.length).toBe(1);
          expect(diags[0].file !.fileName).toBe(_('/test.ts'));
          expect(getSourceCodeForDiagnostic(diags[0])).toBe('user.does_not_exist');
        });

        it('should be correct for indirect templates', async() => {
          env.write('test.ts', `
          import {Component, NgModule} from '@angular/core';
      
          const TEMPLATE = \`<p>
            {{user.does_not_exist}}
          </p>\`;

          @Component({
            selector: 'test',
            template: TEMPLATE,
          })
          export class TestCmp {
            user: {name: string}[];
          }`);

          const diags = await driveDiagnostics();
          expect(diags.length).toBe(1);
          expect(diags[0].file !.fileName).toBe(_('/test.ts') + ' (TestCmp template)');
          expect(getSourceCodeForDiagnostic(diags[0])).toBe('user.does_not_exist');
          expect(getSourceCodeForDiagnostic(diags[0].relatedInformation ![0])).toBe('TEMPLATE');
        });

        it('should be correct for external templates', async() => {
          env.write('template.html', `<p>
          {{user.does_not_exist}}
        </p>`);
          env.write('test.ts', `
          import {Component, NgModule} from '@angular/core';
      

          @Component({
            selector: 'test',
            templateUrl: './template.html',
          })
          export class TestCmp {
            user: {name: string}[];
          }`);

          const diags = await driveDiagnostics();
          expect(diags.length).toBe(1);
          expect(diags[0].file !.fileName).toBe(_('/template.html'));
          expect(getSourceCodeForDiagnostic(diags[0])).toBe('user.does_not_exist');
          expect(getSourceCodeForDiagnostic(diags[0].relatedInformation ![0]))
              .toBe(`'./template.html'`);
        });
      });
    });
  });
});

function getSourceCodeForDiagnostic(diag: ts.Diagnostic): string {
  const text = diag.file !.text;
  return text.substr(diag.start !, diag.length !);
}
