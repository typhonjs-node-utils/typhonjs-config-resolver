/**
 * @typedef {object} ConfigResolverData - Provides a complete set of data for config resolution.
 *
 * @property {object}                           [defaultValues] - Accessor entry to default value applied after
 *                                                                pre-validation and extension resolution.
 *
 * @property {object<string, ValidationEntry>}  [preValidate] - Accessor entry to typhonjs-object-util validation
 *                                                              entries applied at the start of resolving a config
 *                                                              object.
 *
 * @property {object<string, ValidationEntry>}  [postValidate] - Accessor entry to typhonjs-object-util validation
 *                                                               entries applied after extension resolution and any
 *                                                               default values are set.
 *
 * @property {Array<string>}                    [updateMergeList] - A list of strings indicating keys which will be
 *                                                                updated to an array and merged.
 */
