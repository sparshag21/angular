#!/bin/bash

# Do not immediately exit on error to allow the `assertSucceeded` function to handle the error.
#
# NOTE:
# Each statement should be followed by an `assertSucceeded`/`assertFailed` or `exit 1` statement.
set +e -x

PATH=$PATH:$(npm bin)

function assertFailed {
  if [[ $? -eq 0 ]]; then
    echo "FAIL: $1";
    exit 1;
  fi
}

function assertSucceeded {
  if [[ $? -ne 0 ]]; then
    echo "FAIL: $1";
    exit 1;
  fi
}


ivy-ngcc --help
assertSucceeded "Expected 'ivy-ngcc --help' to succeed."

# node --inspect-brk $(npm bin)/ivy-ngcc -f esm2015
# Run ngcc and check it logged compilation output as expected
ivy-ngcc | grep 'Compiling'
assertSucceeded "Expected 'ivy-ngcc' to log 'Compiling'."


# Did it add the appropriate build markers?

  # - esm2015
  cat node_modules/@angular/common/package.json | awk 'ORS=" "' | grep '"__processed_by_ivy_ngcc__":[^}]*"esm2015": "'
  assertSucceeded "Expected 'ivy-ngcc' to add build marker for 'esm2015' in '@angular/common'."

  # - fesm2015
  cat node_modules/@angular/common/package.json | awk 'ORS=" "' | grep '"__processed_by_ivy_ngcc__":[^}]*"fesm2015": "'
  assertSucceeded "Expected 'ivy-ngcc' to add build marker for 'fesm2015' in '@angular/common'."

  cat node_modules/@angular/common/package.json | awk 'ORS=" "' | grep '"__processed_by_ivy_ngcc__":[^}]*"es2015": "'
  assertSucceeded "Expected 'ivy-ngcc' to add build marker for 'es2015' in '@angular/common'."

  # - esm5
  cat node_modules/@angular/common/package.json | awk 'ORS=" "' | grep '"__processed_by_ivy_ngcc__":[^}]*"esm5": "'
  assertSucceeded "Expected 'ivy-ngcc' to add build marker for 'esm5' in '@angular/common'."

  # - fesm5
  cat node_modules/@angular/common/package.json | awk 'ORS=" "' | grep '"__processed_by_ivy_ngcc__":[^}]*"module": "'
  assertSucceeded "Expected 'ivy-ngcc' to add build marker for 'module' in '@angular/common'."

  cat node_modules/@angular/common/package.json | awk 'ORS=" "' | grep '"__processed_by_ivy_ngcc__":[^}]*"fesm5": "'
  assertSucceeded "Expected 'ivy-ngcc' to add build marker for 'fesm5' in '@angular/common'."


# Did it replace the PRE_R3 markers correctly?
  grep "= SWITCH_COMPILE_COMPONENT__POST_R3__" node_modules/@angular/core/fesm2015/core.js
  assertSucceeded "Expected 'ivy-ngcc' to replace 'SWITCH_COMPILE_COMPONENT__PRE_R3__' in '@angular/core' (fesm2015)."

  grep "= SWITCH_COMPILE_COMPONENT__POST_R3__" node_modules/@angular/core/fesm5/core.js
  assertSucceeded "Expected 'ivy-ngcc' to replace 'SWITCH_COMPILE_COMPONENT__PRE_R3__' in '@angular/core' (fesm5)."


# Did it compile @angular/core/ApplicationModule correctly?
  grep "ApplicationModule.ngModuleDef = ɵɵdefineNgModule" node_modules/@angular/core/fesm2015/core.js
  assertSucceeded "Expected 'ivy-ngcc' to correctly compile 'ApplicationModule' in '@angular/core' (fesm2015)."

  grep "ApplicationModule.ngModuleDef = ɵɵdefineNgModule" node_modules/@angular/core/fesm5/core.js
  assertSucceeded "Expected 'ivy-ngcc' to correctly compile 'ApplicationModule' in '@angular/core' (fesm5)."

  grep "ApplicationModule.ngModuleDef = ɵngcc0.ɵɵdefineNgModule" node_modules/@angular/core/esm2015/src/application_module.js
  assertSucceeded "Expected 'ivy-ngcc' to correctly compile 'ApplicationModule' in '@angular/core' (esm2015)."

  grep "ApplicationModule.ngModuleDef = ɵngcc0.ɵɵdefineNgModule" node_modules/@angular/core/esm5/src/application_module.js
  assertSucceeded "Expected 'ivy-ngcc' to correctly compile 'ApplicationModule' in '@angular/core' (esm5)."


# Did it transform @angular/core typing files correctly?
  grep "import [*] as ɵngcc0 from './src/r3_symbols';" node_modules/@angular/core/core.d.ts
  assertSucceeded "Expected 'ivy-ngcc' to add an import for 'src/r3_symbols' in '@angular/core' typings."

  grep "static ngInjectorDef: ɵngcc0.ɵɵInjectorDef<ApplicationModule>;" node_modules/@angular/core/core.d.ts
  assertSucceeded "Expected 'ivy-ngcc' to add a definition for 'ApplicationModule.ngInjectorDef' in '@angular/core' typings."


# Did it generate a base factory call for synthesized constructors correctly?
  grep "const ɵMatTable_BaseFactory = ɵngcc0.ɵɵgetInheritedFactory(MatTable);" node_modules/@angular/material/esm2015/table.js
  assertSucceeded "Expected 'ivy-ngcc' to generate a base factory for 'MatTable' in '@angular/material' (esm2015)."

  grep "const ɵMatTable_BaseFactory = ɵngcc0.ɵɵgetInheritedFactory(MatTable);" node_modules/@angular/material/esm5/table.es5.js
  assertSucceeded "Expected 'ivy-ngcc' to generate a base factory for 'MatTable' in '@angular/material' (esm5)."


# Did it generate a base definition for undecorated classes with inputs and view queries?
  grep "_MatMenuBase.ngBaseDef = ɵngcc0.ɵɵdefineBase({ inputs: {" node_modules/@angular/material/esm2015/menu.js
  assertSucceeded "Expected 'ivy-ngcc' to generate a base definition for 'MatMenuBase' in '@angular/material' (esm2015)."

  grep "_MatMenuBase.ngBaseDef = ɵngcc0.ɵɵdefineBase({ inputs: {" node_modules/@angular/material/esm5/menu.es5.js
  assertSucceeded "Expected 'ivy-ngcc' to generate a base definition for 'MatMenuBase' in '@angular/material' (esm5)."


# Did it handle namespace imported decorators in UMD using `__decorate` syntax?
  grep "type: i0.Injectable" node_modules/@angular/common/bundles/common.umd.js
  assertSucceeded "Expected 'ivy-ngcc' to correctly handle '__decorate' syntax in '@angular/common' (umd)."

  # (and ensure the @angular/common package is indeed using `__decorate` syntax)
  grep "JsonPipe = __decorate(" node_modules/@angular/common/bundles/common.umd.js.__ivy_ngcc_bak
  assertSucceeded "Expected '@angular/common' (umd) to actually use '__decorate' syntax."


# Did it handle namespace imported decorators in UMD using static properties?
  grep "type: core.Injectable," node_modules/@angular/cdk/bundles/cdk-a11y.umd.js
  assertSucceeded "Expected 'ivy-ngcc' to correctly handle decorators via static properties in '@angular/cdk/a11y' (umd)."

  # (and ensure the @angular/cdk/a11y package is indeed using static properties)
  grep "FocusMonitor.decorators =" node_modules/@angular/cdk/bundles/cdk-a11y.umd.js.__ivy_ngcc_bak
  assertSucceeded "Expected '@angular/cdk/a11y' (umd) to actually have decorators via static properties."


# Can it be safely run again (as a noop)?
# And check that it logged skipping compilation as expected
ivy-ngcc -l debug | grep 'Skipping'
assertSucceeded "Expected 'ivy-ngcc -l debug' to successfully rerun (as a noop) and log 'Skipping'."

# Does it process the tasks in parallel?
ivy-ngcc -l debug | grep 'Running ngcc on ClusterExecutor'
assertSucceeded "Expected 'ivy-ngcc -l debug' to run in parallel mode (using 'ClusterExecutor')."

# Check that running it with logging level error outputs nothing
ivy-ngcc -l error | grep '.'
assertFailed "Expected 'ivy-ngcc -l error' to not output anything."

# Does running it with --formats fail?
ivy-ngcc --formats fesm2015
assertFailed "Expected 'ivy-ngcc --formats fesm2015' to fail (since '--formats' is deprecated)."

# Now try compiling the app using the ngcc compiled libraries
ngc -p tsconfig-app.json
assertSucceeded "Expected the app to successfully compile with the ngcc-processed libraries."

# Did it compile the main.ts correctly (including the ngIf and MatButton directives)?
  grep "directives: \[.*\.NgIf.*\]" dist/src/main.js
  assertSucceeded "Expected the compiled app's 'main.ts' to list 'NgIf' in 'directives'."

  grep "directives: \[.*\.MatButton.*\]" dist/src/main.js
  assertSucceeded "Expected the compiled app's 'main.ts' to list 'MatButton' in 'directives'."
