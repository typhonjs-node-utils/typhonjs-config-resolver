import { testEventbus } from 'backbone-esnext-eventbus';
import { assert }       from 'chai';
import PluginManager    from 'typhonjs-plugin-manager';

import testData         from 'typhonjs-config-resolver-tests/testdata';

const pluginManager = new PluginManager({ eventbus: testEventbus });

// Initialize ConfigResolver plugin with no defaults or validation data.
pluginManager.add({ name: 'extend-resolver', target: './src/ConfigResolver.js' });

// Initialize ConfigResolver plugin with extension disabled.
pluginManager.add({
   name: 'noextend-resolver',
   target: './src/ConfigResolver.js',
   options: { eventPrepend: 'noextend', resolverData: { allowExtends: false } }
});

// Uncomment the line below to log resolution chains.
// testEventbus.on('log:info', console.log);

/** @test {ConfigResolver} */
describe('ConfigResolver', () =>
{
   it('throws on no data', () =>
   {
      assert.throws(() => testEventbus.trigger('config:resolver:resolve'));
   });

   it('allowExtends: false; does not allow extension', () =>
   {
      const config = testEventbus.triggerSync('noextend:config:resolver:resolve', testData[0].tests[0].config);

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
               const config = testEventbus.triggerSync('config:resolver:resolve', test.config);

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

