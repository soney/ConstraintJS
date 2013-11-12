	var IRNode = function(type_str, text_content) {
		var types = type_str.split("/");
		this.type = types[0];
		this.subtype = types[1] || null;

		this.text = text_content;
		this.value = null;
		this.children = [];
		this.parent = null;
	};

	(function(my) {
		var proto = my.prototype;
		proto.push_child = function(child) {
			this.children.push(child);
			if(child instanceof my) {
				child.set_parent(this);
			}
		};
		proto.insert_child_at = function(child, index) {
			this.children.splice(index, 0, child);
			
			if(child instanceof my) {
				child.set_parent(this);
			}
		};
		proto.set_children = function(children) {
			this.children = children;
			var self = this;
			each(this.children, function(child) {
				if(child instanceof my) {
					child.set_parent(self);
				}
			});
		};
		proto.child_index = function(child) {
			return indexOf(this.children, child);
		};
		proto.set_value = function(value) {
			this.value = value;
		};
		proto.set_parent = function(parent) {
			this.parent = parent;
		};
		proto.remove_child = function(child) {
			var index = this.children.indexOf(child);
			if(index >= 0) {
				this.children.splice(index, 1);
			}
			if(child.parent === this) {
				child.set_parent(null);
			}
			return child;
		};
		proto.to_str = function(transformer) {
			if(!isFunction(transformer)) {
				transformer = function(child) {
					if(child instanceof my) {
						return child.to_str(transformer);
					} else {
						return child;
					}
				};
			}

			var rv = map(this.children, function(child) {
				return transformer(child);
			});
			return rv.join("");
		};
	}(IRNode));

	var build_ir = function(parse_tree_root, ir_root) {
		var type = parse_tree_root[0],
			args = parse_tree_root.slice(1),
			rv, tag, tag_content;
		if(type === "multi") {
			var children = map(args, function(arg) {
				return build_ir(arg, ir_root);
			});
			ir_root.set_children(children);
			return parse_tree_root;
		} else if(type === "static") {
			return args[0];
		} else if(type === "mustache") {
			var subtype = args[0];
			args = rest(args);
			if(subtype === "etag" || subtype === "utag") {
				rv = new IRNode("mustache/variable", args[1]);
				rv.set_value({
					var_name: args[0],
					escaped: subtype === "etag"
				});
				return rv;
			} else if(subtype === "section" || subtype === "inverted_section") {
				tag = args[0];
				tag_content = args[1];
				var text_content = args[2],
					sub_trees = args[3];

				rv = new IRNode("mustache/"+subtype, text_content);
				var attribute_start_index = tag_content.indexOf(" ");
				var attributes;
				if(attribute_start_index<0) {
					attributes = null;
				} else {
					attributes = tag_content.substring(attribute_start_index+1);
				}
				rv.set_value({
					tag: tag,
					attributes: attributes
				});

				build_ir(sub_trees, rv);

				return rv;
			} else if(subtype === "partial") {
				tag = args[0];
				tag_content = args[1];
				rv = new IRNode("mustache/partial", tag_content);
				rv.set_value(tag);
				return rv;
			} else {
				console.log("Unknown mustache type", subtype);
			}
		} else {
			console.log("Unknown type", type);
		}
	};

	var is_tag = function(ir_root, tag_name) {
		return ir_root.type === "mustache" && ir_root.subtype === "section" && ir_root.value && ir_root.value.tag === tag_name;
	};
	var extract_elses = function(ir_root) {
		if(is_tag(ir_root, "if")) {
			var i, len;

			var children_to_elevate = [];
			for(i = 0, len=ir_root.children.length; i<len; i++) {
				var child = ir_root.children[i];
				if(is_tag(child, "if")) {
					break;
				} else if(is_tag(child, "elif") || is_tag(child, "else")) { // encountered before another if
					children_to_elevate.push(child);
				}
			}
			var if_parent = ir_root.parent;
			var curr_index = if_parent.child_index(ir_root) + 1;
			each(children_to_elevate, function(child) {
				ir_root.remove_child(child);
				if_parent.insert_child_at(child, curr_index);
				curr_index+=1;
			});
		}

		each(ir_root.children, function(child) {
			extract_elses(child);
		});
	};

	var integrate_expressions = function(ir_root) {
		if(has(ir_root, "value") && !_.isNull(ir_root.value)) {
			if(has(ir_root.value, "attributes") && !_.isNull(ir_root.value.attributes)) {
				var attributes = ir_root.value.attributes;
				var parsed_attributes = cjs.__parsers.expression(attributes);
				ir_root.value.parsed_attributes = parsed_attributes;
			} else if(_.has(ir_root.value, "var_name")) {
				var var_name = ir_root.value.var_name;
				var parsed_var_name = cjs.__parsers.expression(var_name);
				ir_root.value.parsed_var_name = parsed_var_name;
			}
		}
		each(ir_root.children, function(child) {
			integrate_expressions(child);
		});
	};

	var extraction_regex = /\{cjs\{([#\/]?)(\d+)\}cjs\}/;
	var extract_handlebars = function(str) {
		var buffer = str;
		var rv = [];
		var match;

		do {
			match = buffer.match(extraction_regex);
			if(match) {
				var str_index = buffer.indexOf(match[0]);
				if(str_index > 0) {
					rv.push(buffer.substr(0, str_index));
				}
				buffer = buffer.substr(str_index + match[0].length);
				var modifier = match[1];
				var handlebar_id = parseInt(match[2], 10);

				rv.push({
					type: "handlebars",
					modifier: modifier,
					handlebar_id: handlebar_id
				});
			} else {
				rv.push(buffer);
				buffer = "";
			}
		} while (buffer.length > 0);

		return rv;
	};

	var get_unique_handlebars_opening = function(id) {
		var rv = "{cjs{#"+id+"}cjs}";
		return rv;
	};
	var get_unique_handlebars_closing = function(id) {
		var rv = "{cjs{/"+id+"}cjs}";
		return rv;
	};
	var get_unique_handlebars_str = function(id) {
		var rv = "{cjs{"+id+"}cjs}";
		return rv;
	};

	var integrate_html = function(ir_root) {
		var handlebars_map = [];
		var id = 0;
		var transformer, unique_id, rv;
		transformer = function(child) {
			if(child instanceof IRNode) {
				if(child.value) {
					if(child.type === "mustache") {
						if(child.subtype === "section") {
							unique_id = id;
							handlebars_map[unique_id] = child;
							id++;
							rv = get_unique_handlebars_opening(unique_id) + child.to_str(transformer) + get_unique_handlebars_closing(unique_id);
							return rv;
						} else {
							unique_id = id;
							handlebars_map[unique_id] = child;
							id++;
							rv = get_unique_handlebars_str(unique_id);
							return rv;
						}
					} else {
						throw new Exception("Nothing but mustache expressions allowed at this stage of IR building");
					}
				} else {
					return child.to_str(transformer);
				}
			} else {
				return child;
			}
		};

		var stack = [ir_root];
		var str = ir_root.to_str(transformer);
		ir_root.set_children([]);
		cjs.__parsers.html(str, {
			start: function(tag_name, attrs, unary) {
				var parent = _.last(stack);
				var node = new IRNode("html/tag");
				node.value = {
					tag_name: tag_name
				};
				if(!unary) {
					stack.push(node);
				}
				parent.push_child(node);

				var new_node;
				node.attrs = [];
				each(attrs, function(attr) {
					var attr_name = attr.name;
					var attr_value = _.map(extract_handlebars(attr.value), function(child) {
						if(isString(child)) {
							return child;
						} else {
							new_node = handlebars_map[child.handlebar_id];
							if(child.modifier === "#") {
								//throw new Error("Cannot handle expressions in attributes yet");
								return new_node;
							} else if(child.modifier === "/") {
								//throw new Error("Cannot handle expressions in attributes yet");
								return false;
							} else {
								return new_node;
							}
						}
					});
					node.attrs.push({
						name: attr_name,
						value: compact(attr_value)
					});
				});
			},
			end: function(tag_name) {
				var node = stack.pop();
				if(node.value.tag_name !== tag_name) {
					throw new Exception("Could not resolve", tag_name, node);
				}
			},
			chars: function(text) {
				var new_node, parent;
				each(extract_handlebars(text), function(child) {
					if(isString(child)) {
						parent = last(stack);
						parent.push_child(child);
					} else {
						new_node = handlebars_map[child.handlebar_id];
						if(child.modifier === "#") {
							new_node.set_children([]);
							parent = last(stack);
							parent.push_child(new_node);
							stack.push(new_node);
						} else if(child.modifier === "/") {
							var node = stack.pop();
							if(node !== new_node) {
								throw new Exception("Out of order: ", node.text, new_node.text);
							}
						} else {
							parent = last(stack);
							parent.push_child(new_node);
						}
					}
				});
			},
			comment: function(text) {
				var parent = last(stack);
				var new_node = new IRNode("html/comment", text);
				parent.push_child(new_node);
			}
		});
	};

	cjs.__ir_builders.handlebars = function (parse_tree, options) {
		var root = new IRNode("root", parse_tree.content);
		build_ir(parse_tree.tokens, root);
		extract_elses(root);
		integrate_expressions(root);
		integrate_html(root);
		return root;
	};