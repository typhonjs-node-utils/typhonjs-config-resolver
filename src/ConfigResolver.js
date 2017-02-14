import fs                  from 'fs';
import path                from 'path';
import stripJsonComments   from 'strip-json-comments';
import ObjectUtil          from 'typhonjs-object-util';

/**
 * Provides the default common config resolution process resolving any extensions and setting default values.
 *
 * Both file and NPM modules are supported for config extension via the `extends` as a string or array of strings.
 *
 * Validation is also available when setting pre and post validation data via `setResolverData`.
 *
 * ConfigResolver is modeled after the extensions functionality of ESLint. Please see the respective licenses of the
 * code modified at the end of this file.
 */
export default class ConfigResolver
{
   /**
    * Instantiate ConfigResolver potentially destructuring an object passed in with the following keys.
    *
    * @param {ConfigResolverData}   [resolverData] - Any default values to apply after resolution.
    */
   constructor(resolverData = void 0)
   {
      this.setResolverData(resolverData);
   }

   /**
    * Applies values from the "extends" field in a configuration file.
    *
    * @param {Object}      config The configuration information.
    *
    * @param {string}      filePath The file path from which the configuration information was loaded.
    *
    * @param {string}      [relativeTo] The path to resolve relative to.
    *
    * @param {function}    [validate] - A function performing validation.
    *
    * @param {string[]}    [loadedConfigs] The config files already loaded.
    *
    * @returns {Object} A new configuration object with all of the "extends" fields loaded and merged.
    */
   _applyExtends(config, filePath, relativeTo, validate, loadedConfigs = [])
   {
      let configExtends = config.extends;

      // Normalize into an array for easier handling
      if (!Array.isArray(config.extends)) { configExtends = [config.extends]; }

      // Make the last element in an array take the highest precedence
      config = configExtends.reduceRight((previousValue, parentPath) =>
      {
         if (this._isFilePath(parentPath))
         {
            // If the `extends` path is relative, use the directory of the current configuration
            // file as the reference point. Otherwise, use as-is.
            parentPath = (!path.isAbsolute(parentPath) ?
             path.join(relativeTo || path.dirname(filePath), parentPath) : parentPath);
         }

         // Early out if this path has already been loaded; prevents circular dependencies.
         if (loadedConfigs.indexOf(parentPath) >= 0) { return previousValue; }

         if (this._eventbus) { this._eventbus.trigger('log:info:raw', `resolving config extends: ${parentPath}`); }

         // Stores the loaded config path.
         loadedConfigs.push(parentPath);

         return this._deepMerge(this._load(parentPath, relativeTo, validate, loadedConfigs), previousValue);
      }, config);

      return config;
   }

   /**
    * Merges two config objects. This will not only add missing keys, but will also modify values to match.
    *
    * If an object key is included in this._upgradeMergeList it will be upgraded and merged into an array without
    * duplicating elements.
    *
    * @param {Object}   target - Config object.
    *
    * @param {Object}   src - Config object. Overrides in this config object will take priority over the base.
    *
    * @param {boolean}  [combine] - Whether to combine arrays or not.
    *
    * @param {string}   [parentKey] - The parent key of the merged items if any.
    *
    * @returns {Object} merged config object.
    */
   _deepMerge(target, src, combine = false, parentKey = void 0)
   {
      const array = Array.isArray(src) || Array.isArray(target);

      let dst = array && [] || {};

      combine = !!combine;

      if (array)
      {
         target = target || [];

         // src could be a string, so check for array
         if (Array.isArray(src) && src.length > 1)
         {
            dst = dst.concat(src);
         }
         else
         {
            dst = dst.concat(target);
         }

         if (typeof src !== "object" && !Array.isArray(src))
         {
            src = [src];
         }

         // Plugin merging is handled separately in reverse order and is skipped in merging object elements below.
         if (parentKey === 'plugins' && Array.isArray(target))
         {
            // Push target plugin config if not found in merged destination.
            target.forEach((plugin) =>
            {
               if (!dst.find((dstPlugin) => dstPlugin.name === plugin.name)) { dst.push(plugin); }
            });

            // Replace any existing plugin config in destination that matches a plugin config name from source.
            src.forEach((plugin) =>
            {
               const index = dst.findIndex((dstPlugin) => dstPlugin.name === plugin.name);

               // Potentially remove old plugin with matching name to new plugin.
               if (index >= 0) { dst.splice(index, 1); }

               // Add the new plugin to head of array.
               dst.unshift(plugin);
            });
         }

         Object.keys(src).forEach((srcElement, srcIndex) =>
         {
            srcElement = src[srcIndex];

            if (typeof dst[srcIndex] === "undefined")
            {
               dst[srcIndex] = srcElement;
            }
            else if (typeof srcElement === "object")
            {
               if (parentKey !== 'plugins')
               {
                  dst[srcIndex] = this._deepMerge(target[srcIndex], srcElement, combine, parentKey);
               }
            }
            else
            {
               if (!combine)
               {
                  dst[srcIndex] = srcElement;
               }
               else
               {
                  if (dst.indexOf(srcElement) === -1)
                  {
                     dst.push(srcElement);
                  }
               }
            }
         });
      }
      else
      {
         if (target && typeof target === "object")
         {
            Object.keys(target).forEach((targetKey) =>
            {
               dst[targetKey] = target[targetKey];
            });
         }

         Object.keys(src).forEach((srcKey) =>
         {
            // Potentially upgrade any single value to an array.
            if (this._upgradeMergeList.indexOf(srcKey) >= 0 && !Array.isArray(src[srcKey]))
            {
               src[srcKey] = [src[srcKey]];
            }

            if (Array.isArray(src[srcKey]) || Array.isArray(target[srcKey]))
            {
               dst[srcKey] = this._deepMerge(target[srcKey], src[srcKey], this._upgradeMergeList.indexOf(srcKey) >= 0,
                srcKey);
            }
            else if (typeof src[srcKey] !== 'object' || !src[srcKey])
            {
               dst[srcKey] = src[srcKey];
            }
            else
            {
               dst[srcKey] = this._deepMerge(target[srcKey] || {}, src[srcKey], combine, srcKey);
            }
         });
      }

      return dst;
   }

   /**
    * Returns the resolver data as a ConfigResolverData object.
    *
    * Note: that this is the active data and a copy is not made.
    *
    * @returns {ConfigResolverData}
    */
   getResolverData()
   {
      return {
         defaultValues: this._defaultValues,
         preValidate: this._preValidate,
         postValidate: this._postValidate,
         upgradeMergeList: this._upgradeMergeList
      };
   }

   /**
    * Determines if a given string represents a filepath or not using the same conventions as require(), meaning that
    * the first character must be non-alphanumeric and not the @ sign which is used for scoped packages to be considered
    * a file path.
    *
    * @param {string} filePath The string to check.
    *
    * @returns {boolean} True if it's a filepath, false if not.
    */
   _isFilePath(filePath)
   {
      return path.isAbsolute(filePath) || !(/\w|@/.test(filePath.charAt(0)));
   }

   /**
    * Loads a configuration file from the given file path.
    *
    * @param {string}      filePath The filename or package name to load the configuration information from.
    *
    * @param {string}      [relativeTo] The path to resolve relative to.
    *
    * @param {function}    [validate] - A function performing validation.
    *
    * @param {string[]}    [loadedConfigs] The config files already loaded.
    *
    * @returns {Object} The configuration information.
    */
   _load(filePath, relativeTo = '', validate, loadedConfigs)
   {
      let config, dirname;

      // Resolve relative file path otherwise assume filePath is from an NPM module.
      if (this._isFilePath(filePath))
      {
         const resolvedPath = path.resolve(relativeTo, filePath);
         dirname = path.dirname(resolvedPath);

         const ext = path.extname(resolvedPath);

         if (ext === '.js')
         {
            config = require(resolvedPath);
         }
         else
         {
            const configJSON = fs.readFileSync(resolvedPath, { encode: 'utf8' }).toString();

            config = JSON.parse(stripJsonComments(configJSON));
         }
      }
      else
      {
         config = require(filePath);
      }

      // Perform pre-validation for the loaded config.
      if (validate) { validate(config); }

      if (config)
      {
         // If an `extends` property is defined, it represents a configuration file to use as a `parent`. Load the
         // referenced file and merge the configuration recursively.
         if (config.extends)
         {
            config = this._applyExtends(config, filePath, dirname, validate, loadedConfigs);
         }
      }

      return config;
   }

   /**
    * Stores any associated plugin eventbus and attempts loading of . The following event bindings are available:
    *
    * `config:resolver:resolve`: Invokes `resolve`.
    * `config:resolver:validate:pre`: Invokes `preValidate`.
    * `config:resolver:validate:post`: Invokes `postValidate`.
    *
    * @param {PluginEvent} ev - The plugin event.
    */
   onPluginLoad(ev)
   {
      const eventbus = ev.eventbus;
      const options = ev.pluginOptions;

      /**
       * @type {EventProxy} - The plugin manager event proxy.
       */
      this._eventbus = eventbus;

      let eventPrepend = '';

      // Apply any resolver data.
      if (typeof options.resolverData === 'object') { this.setResolverData(options.resolverData); }

      // If `eventPrepend` is defined then it is prepended before all event bindings.
      if (typeof options.eventPrepend === 'string') { eventPrepend = `${options.eventPrepend}:`; }

      eventbus.on(`${eventPrepend}config:resolver:resolve`, this.resolve, this);
      eventbus.on(`${eventPrepend}config:resolver:validate:pre`, this.preValidate, this);
      eventbus.on(`${eventPrepend}config:resolver:validate:post`, this.postValidate, this);
   }

   /**
    * Validates a config object for any missing or incorrect parameters after resolving.
    *
    * @param {object}   config - A config object to validate.
    *
    * @param {string}   [configName='config'] - Optional name of the config object.
    */
   postValidate(config, configName = 'config')
   {
      if (this._postValidate) { ObjectUtil.validate(config, this._postValidate, configName); }
   }

   /**
    * Validates a config object for any missing or incorrect parameters before and during resolving extended config
    * data.
    *
    * @param {object}   config - A config object to validate.
    *
    * @param {string}   [configName='config'] - Optional name of the config object.
    */
   preValidate(config, configName = 'config')
   {
      if (this._preValidate) { ObjectUtil.validate(config, this._preValidate, configName); }
   }

   /**
    * Resolves any config extension and sets missing default config values.
    *
    * @param {object}   config - A config object to resolve.
    *
    * @override
    */
   resolve(config)
   {
      if (typeof config !== 'object') { throw new TypeError(`'config' is not an 'object'.`); }

      this.preValidate(config);

      const resolvedConfig = this._resolveExtends(config);

      this.setDefaultValues(resolvedConfig);

      this.postValidate(resolvedConfig);

      return resolvedConfig;
   }

   /**
    * Provides config extension implementation.
    *
    * @param {object}   config - A config object to resolve.
    *
    * @returns {*}
    * @private
    */
   _resolveExtends(config)
   {
      if (!config.extends) { return JSON.parse(JSON.stringify(config)); }

      const dirPath = process.cwd();

      const loadedConfigs = [];

      let resolvedConfig;

      try
      {
         resolvedConfig = this._applyExtends(config, dirPath, dirPath, this.preValidate.bind(this), loadedConfigs);
      }
      catch (err)
      {
         // Add the sequence of loaded config files so the user is able to see where the error occurred.
         err.message += `\nReferenced from: \n${loadedConfigs.join('\n')}`;

         throw err;
      }

      // Replace any merged `extends` entries with the resolved loaded order / extends entries.
      if (loadedConfigs.length > 0)
      {
         delete resolvedConfig.extends;

         resolvedConfig.extends = loadedConfigs;
      }

      // Reverse plugin order so that the earliest plugins in extended config chains appear first.
      if (Array.isArray(resolvedConfig.plugins)) { resolvedConfig.plugins.reverse(); }

      return resolvedConfig;
   }

   /**
    * Sets default config values.
    *
    * @param {object}   config - A config object to set default values that do not already exist.
    */
   setDefaultValues(config)
   {
      if (this._defaultValues) { ObjectUtil.safeSetAll(config, this._defaultValues, 'set-undefined', false); }
   }

   /**
    * Sets the config resolver data.
    *
    * Note: For values of ConfigResolverData not set empty defaults are provided.
    */
   setResolverData({ defaultValues = {}, preValidate = {}, postValidate = {}, upgradeMergeList = [] } = {})
   {
      if (typeof defaultValues !== 'object') { throw new TypeError(`'defaultValues' is not an 'object'.`); }
      if (typeof preValidate !== 'object') { throw new TypeError(`'preValidate' is not an 'object'.`); }
      if (typeof postValidate !== 'object') { throw new TypeError(`'postValidate' is not an 'object'.`); }
      if (!Array.isArray(upgradeMergeList)) { throw new TypeError(`'upgradeMergeList' is not an 'array'.`); }

      /**
       * Accessor entry to default value.
       * @type {object}
       */
      this._defaultValues = defaultValues;

      /**
       * Accessor entry to typhonjs-object-util validation entry.
       * @type {object}
       */
      this._preValidate = preValidate;

      /**
       * Accessor entry to typhonjs-object-util validation entry.
       * @type {object}
       */
      this._postValidate = postValidate;

      /**
       * A list of strings indicating keys which will be updated to an array and merged.
       * @type {Array<string>}
       */
      this._upgradeMergeList = upgradeMergeList;
   }
}

/**
 * Wires up an instance of ConfigResolver on the plugin eventbus. The following event bindings are available:
 *
 * @param {PluginEvent} ev - The plugin event.
 *
 * @ignore
 */
export function onPluginLoad(ev)
{
   new ConfigResolver().onPluginLoad(ev);
}

// ------------------------------------------------------------------------------------------------------------------

/*
 Some of the code above has been adapted from ESLint for supporting config extension.
 Please see: https://github.com/eslint/eslint

 ESLint
 Copyright JS Foundation and other contributors, https://js.foundation

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.


 The code for `_deepMerge` is taken from deepmerge repo (https://github.com/KyleAMathews/deepmerge) and modified to
 support typhonjs-plugin-manager plugin resolution.

 The MIT License (MIT)
 Copyright (c) 2012 Nicholas Fisher
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:
 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */
