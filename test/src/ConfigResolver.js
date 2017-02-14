import TyphonEvents  from 'backbone-esnext-events/src/TyphonEvents';
import { assert }    from 'chai';
import PluginManager from 'typhonjs-plugin-manager';

import testData      from 'typhonjs-config-resolver-tests/testdata';

const eventbus = new TyphonEvents();

// eventbus.on('log:info:raw', console.log);

const pluginManager = new PluginManager({ eventbus });

// Initialize ConfigResolver plugin with no defaults or validation data.
pluginManager.add({ name: './src/ConfigResolver.js' });

/** @test {ConfigResolver} */
describe('ConfigResolver', () =>
{
   it('throws on no data', () =>
   {
      assert.throws(() => eventbus.trigger('config:resolver:resolve'));
   });

   for (const category of testData)
   {
      describe(category.title, () =>
      {
         for (const test of category.tests)
         {
            it(test.title, () =>
            {
               const config = eventbus.triggerSync('config:resolver:resolve', test.config);

               // Must delete extends array as it has resolved file names.
               if (test.removeExtends)
               {
                  assert.isArray(config.extends);
                  assert.lengthOf(config.extends, test.removeExtends);
                  delete config.extends;
               }

               assert.strictEqual(JSON.stringify(config), test.verify);
            });
         }
      });
   }
});

