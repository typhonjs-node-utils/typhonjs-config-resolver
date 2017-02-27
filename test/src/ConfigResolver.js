import TyphonEvents  from 'backbone-esnext-events/src/TyphonEvents';
import { assert }    from 'chai';
import PluginManager from 'typhonjs-plugin-manager';

import testData      from 'typhonjs-config-resolver-tests/testdata';

const eventbus = new TyphonEvents();

const pluginManager = new PluginManager({ eventbus });

// Initialize ConfigResolver plugin with no defaults or validation data.
pluginManager.add({ name: 'extend-resolver', target: './src/ConfigResolver.js' });

// Initialize ConfigResolver plugin with extension disabled.
pluginManager.add({
   name: 'noextend-resolver',
   target: './src/ConfigResolver.js',
   options: { eventPrepend: 'noextend', resolverData: { allowExtends: false } }
});

// Uncomment the line below to log resolution chains.
// eventbus.on('log:info', console.log);

/** @test {ConfigResolver} */
describe('ConfigResolver', () =>
{
   it('throws on no data', () =>
   {
      assert.throws(() => eventbus.trigger('config:resolver:resolve'));
   });

   it('allowExtends: false; does not allow extension', () =>
   {
      const config = eventbus.triggerSync('noextend:config:resolver:resolve', testData[0].tests[0].config);

      assert.strictEqual(JSON.stringify(config),
       '{"extends":"./node_modules/typhonjs-config-resolver-tests/config/basic.json"}');
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

